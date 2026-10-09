FROM platformcollective/base-slim:v20261006
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

EXPOSE 3000
CMD [ "node", "bundle.js" ]
