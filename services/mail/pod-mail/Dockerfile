FROM platformcollective/base-slim:v20261102
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

EXPOSE 8097 
CMD [ "node", "bundle.js" ]
