FROM platformcollective/base-slim:v20261102
WORKDIR /usr/src/app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

EXPOSE 3078
CMD [ "node", "bundle.js" ]
