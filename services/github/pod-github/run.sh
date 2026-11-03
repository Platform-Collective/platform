export APP_ID="$POD_GITHUB_APPID"
export CLIENT_ID="$POD_GITHUB_CLIENTID"
export CLIENT_SECRET="$POD_GITHUB_CLIENT_SECRET"
export PRIVATE_KEY="$POD_GITHUB_PRIVATE_KEY"
export SERVER_SECRET=secret
export ACCOUNTS_URL=http://localhost:3000
export COLLABORATOR_URL=ws://relyframe.local:3078
export STORAGE_CONFIG="datalake|http://relyframe.local:4030"
export OTEL_EXPORTER_OTLP_ENDPOINT=http://relyframe.local:4318/v1/traces
rush bundle --to @hcengineering/pod-github
node $@ bundle/bundle.js $@