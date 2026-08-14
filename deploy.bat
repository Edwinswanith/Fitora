@echo off
setlocal enabledelayedexpansion

REM Deploy the Apex API server to Google Cloud Run.
REM Mobile builds are produced separately from the ./mobile Expo app.

set PROJECT_ID=coaching-467814
set REGION=asia-south1
set SERVER_IMAGE=scp-server
set SERVER_SERVICE=scp-server
set ENV_FILE=env.server.yaml

if not exist "%ENV_FILE%" (
  echo Missing %ENV_FILE%. Copy env.server.yaml.example and fill real values.
  exit /b 1
)

echo === Building server image ===
docker build --no-cache -f server/Dockerfile -t gcr.io/%PROJECT_ID%/%SERVER_IMAGE% .
if errorlevel 1 exit /b 1

echo === Pushing server image ===
docker push gcr.io/%PROJECT_ID%/%SERVER_IMAGE%
if errorlevel 1 exit /b 1

echo === Deploying server ===
gcloud run deploy %SERVER_SERVICE% ^
  --project %PROJECT_ID% ^
  --region %REGION% ^
  --image gcr.io/%PROJECT_ID%/%SERVER_IMAGE% ^
  --platform managed ^
  --allow-unauthenticated ^
  --env-vars-file %ENV_FILE%
if errorlevel 1 exit /b 1

echo === Server URL ===
gcloud run services describe %SERVER_SERVICE% --project %PROJECT_ID% --region %REGION% --format "value(status.url)"

endlocal
