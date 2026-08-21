FROM platformcollective/rekoni-base:v20260821
WORKDIR /usr/src/app

RUN npm install --ignore-scripts=false --verbose pdfjs-dist@v6.2.108 --unsafe-perm

COPY bundle/bundle.js ./
EXPOSE 4004
CMD [ "node", "./bundle.js" ]
