FROM platformcollective/base-slim:v20261006
WORKDIR /app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

CMD [ "dumb-init", "node", "bundle.js" ]
