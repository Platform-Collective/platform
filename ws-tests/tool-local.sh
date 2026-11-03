export MODEL_VERSION=$(node ../common/scripts/show_version.js)
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export MINIO_ENDPOINT=relyframe.local:9000
export MONGO_URL=mongodb://relyframe.local:27017
export DB_URL=mongodb://relyframe.local:27017
export ACCOUNT_DB_URL=postgresql://root@relyframe.local:26257/defaultdb?sslmode=disable
export ACCOUNTS_URL=http://relyframe.local:3000
export TRANSACTOR_URL=ws://relyframe.local:3333
export ELASTIC_URL=http://relyframe.local:9200
export SERVER_SECRET=secret
export QUEUE_CONFIG=relyframe.local:19093

# Restore workspace contents in mongo/elastic
node ../dev/tool/bundle/bundle.js $@