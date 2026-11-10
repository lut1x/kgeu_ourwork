#!/bin/sh
# Run on the attached VPS after uploading source and prebuilt image archives.
set -eu
release=/var/backups/tech-scada/gateway-20261015
project=/opt/tech-scada
mkdir -p "$release"
if [ -e "$release/source-before.tar.gz" ]; then
  echo 'Release backup already exists; inspect it before repeating deployment.'
  exit 1
fi
tar -czf "$release/source-before.tar.gz" -C "$project" backend frontend docs
docker tag tech-scada-backend:deploy tech-scada-backend:gateway-before-20261015
docker tag tech-scada-frontend:deploy tech-scada-frontend:gateway-before-20261015
cat > "$release/rollback.sh" <<'ROLLBACK'
#!/bin/sh
set -eu
tar -xzf /var/backups/tech-scada/gateway-20261015/source-before.tar.gz -C /opt/tech-scada
docker tag tech-scada-backend:gateway-before-20261015 tech-scada-backend:deploy
docker tag tech-scada-frontend:gateway-before-20261015 tech-scada-frontend:deploy
scada up -d --no-build backend frontend
ROLLBACK
chmod 700 "$release/rollback.sh"
rollback() {
  result=$?
  if [ "$result" -ne 0 ]; then
    echo 'Deployment failed; restoring previous application images.'
    sh "$release/rollback.sh"
  fi
}
trap rollback EXIT
docker load -i /root/scada-gateway-update-images.tar
tar -xzf /root/scada-gateway-update-source.tar.gz -C "$project"
scada up -d --no-build backend frontend
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS https://scada.lut1x1337.ru:9443/api/health >/dev/null; then ready=true; break; fi
  sleep 3
done
[ "$ready" = true ]
curl -fsS https://scada.lut1x1337.ru:9443/downloads/scada-raspberry-gateway.tar.gz -o "$release/gateway-downloaded.tar.gz"
tar -tzf "$release/gateway-downloaded.tar.gz" >/dev/null
trap - EXIT
scada ps
echo "Deployment ready. Rollback: sh $release/rollback.sh"
