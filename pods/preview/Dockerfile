FROM platformcollective/preview-base:v20260819

WORKDIR /app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

EXPOSE 4040
CMD ["dumb-init", "node", "bundle.js"]
