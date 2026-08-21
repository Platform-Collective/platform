FROM platformcollective/base-slim:v20260821
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

EXPOSE 3000
CMD [ "node", "bundle.js" ]
