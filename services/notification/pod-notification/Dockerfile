FROM platformcollective/base-slim:v20260819
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

EXPOSE 8089 
CMD [ "node", "bundle.js" ]
