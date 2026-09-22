FROM hardcoreeng/base-slim:v20260811
WORKDIR /usr/src/app

COPY bundle/bundle.js ./
COPY assets/avatar.png ./

EXPOSE 4010
CMD [ "node", "bundle.js" ]
