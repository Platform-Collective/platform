FROM platformcollective/base-slim:v20260811
WORKDIR /usr/src/app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

EXPOSE 3600
CMD [ "node", "bundle.js" ]
