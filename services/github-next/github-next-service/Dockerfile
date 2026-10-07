FROM tracexapp/base-slim:v20261006
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

CMD [ "dumb-init", "node", "bundle.js" ]
