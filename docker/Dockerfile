FROM node:18-alpine3.17
RUN apk add --no-cache bash python3 py3-pip && pip install pymongo
WORKDIR /app
ADD ./ .
RUN python3 -m pip install "pymongo[srv]"
RUN npm install
RUN npm run build
CMD ["npm", "start"]