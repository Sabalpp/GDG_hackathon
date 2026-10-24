# Deploys ADAPT to Google Cloud (Dev D). Run from the repository root:
#   .\scripts\deploy.ps1 -ProjectId adapt-hackathon
# Needs: gcloud (logged in), and for the frontend step, firebase-tools.
# Steps whose app folder does not exist yet are skipped, so this works from hour 1.
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$GemmaModel = "gemma-4-26b-a4b-it",
  [switch]$SkipWeb
)
$ErrorActionPreference = "Stop"
$Repo = "adapt"
$Registry = "$Region-docker.pkg.dev/$ProjectId/$Repo"

function Invoke-Checked {
  param([string]$Label, [scriptblock]$Command)
  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)" }
}

function Deploy-Image {
  param([string]$Service, [string]$Dockerfile)
  Invoke-Checked "Build $Service in Cloud Build" {
    gcloud builds submit --project $ProjectId --config cloudbuild.yaml `
      --substitutions "_SERVICE=$Service,_DOCKERFILE=$Dockerfile,_REGION=$Region,_REPO=$Repo" .
  }
}

Invoke-Checked "Select project" { gcloud config set project $ProjectId }
Invoke-Checked "Enable APIs" {
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com `
    cloudbuild.googleapis.com secretmanager.googleapis.com
}

gcloud artifacts repositories describe $Repo --location $Region *> $null
if ($LASTEXITCODE -ne 0) {
  Invoke-Checked "Create Artifact Registry repo" {
    gcloud artifacts repositories create $Repo --repository-format docker --location $Region
  }
}

# --- 1. Geometry (Python) -----------------------------------------------------
# Public but holds no secrets; max-instances caps spend.
Deploy-Image "adapt-geometry" "services/geometry/Dockerfile"
Invoke-Checked "Deploy adapt-geometry" {
  gcloud run deploy adapt-geometry --image "$Registry/adapt-geometry:latest" --region $Region `
    --allow-unauthenticated --max-instances 2 --memory 1Gi --cpu 1 --timeout 60
}
$GeometryUrl = (gcloud run services describe adapt-geometry --region $Region --format "value(status.url)")
Write-Host "Geometry: $GeometryUrl" -ForegroundColor Green

# --- 2. Express API -------------------------------------------------------------
if (Test-Path "apps/api/package.json") {
  gcloud secrets describe gemini-api-key *> $null
  if ($LASTEXITCODE -ne 0) {
    throw @"
Secret 'gemini-api-key' is missing. Create it once (paste the key, then Ctrl+Z, Enter):
  gcloud secrets create gemini-api-key --data-file=-
"@
  }
  $ProjectNumber = (gcloud projects describe $ProjectId --format "value(projectNumber)")
  Invoke-Checked "Let Cloud Run read the Gemini secret" {
    gcloud secrets add-iam-policy-binding gemini-api-key `
      --member "serviceAccount:$ProjectNumber-compute@developer.gserviceaccount.com" `
      --role roles/secretmanager.secretAccessor --condition None
  }
  Deploy-Image "adapt-api" "apps/api/Dockerfile"
  Invoke-Checked "Deploy adapt-api" {
    gcloud run deploy adapt-api --image "$Registry/adapt-api:latest" --region $Region `
      --allow-unauthenticated --max-instances 2 --memory 512Mi --timeout 60 `
      --set-env-vars "NODE_ENV=production,GEMMA_MODEL=$GemmaModel,GEOMETRY_BASE_URL=$GeometryUrl,WEB_ORIGIN=https://$ProjectId.web.app,PROJECT_STORE=memory" `
      --set-secrets "GEMINI_API_KEY=gemini-api-key:latest"
  }
  $ApiUrl = (gcloud run services describe adapt-api --region $Region --format "value(status.url)")
  Write-Host "API: $ApiUrl" -ForegroundColor Green
} else {
  Write-Host "`nSkipping API: apps/api/package.json not found yet (Dev B)." -ForegroundColor Yellow
}

# --- 3. Frontend on Firebase Hosting ------------------------------------------
if (-not $SkipWeb -and (Test-Path "apps/web/package.json")) {
  $env:VITE_API_BASE_URL = "/api/v1"   # same-origin; firebase.json rewrites /api/** to adapt-api
  Invoke-Checked "Install workspace dependencies" { npm install --no-audit --no-fund }
  Invoke-Checked "Build web" { npm run build --workspace apps/web }
  Invoke-Checked "Check bundle for secrets" { node scripts/check-bundle-secrets.mjs apps/web/dist }
  Invoke-Checked "Deploy Firebase Hosting" { npx --yes firebase-tools deploy --only hosting --project $ProjectId }
  Write-Host "Web: https://$ProjectId.web.app" -ForegroundColor Green
} else {
  Write-Host "`nSkipping web: apps/web/package.json not found yet (Dev A) or -SkipWeb set." -ForegroundColor Yellow
}

Write-Host "`nSmoke-test the deployment:" -ForegroundColor Cyan
if ($ApiUrl) { Write-Host "  node scripts/smoke-e2e.mjs --base-url $ApiUrl/api/v1 --express" }
else { Write-Host "  node scripts/smoke-e2e.mjs --base-url $GeometryUrl/api/v1" }
