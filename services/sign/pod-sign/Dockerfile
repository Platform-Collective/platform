FROM hardcoreeng/base-slim:v20260811
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

CMD [ "dumb-init", "node", "bundle.js" ]
