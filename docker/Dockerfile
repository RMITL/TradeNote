# Use Node.js as the base image
FROM node:18-alpine3.17

# Install bash for script compatibility
RUN apk add --no-cache bash

# Set the working directory
WORKDIR /app

# Add the application files
ADD ./ .

# Install Node.js dependencies
RUN npm install

# Install Python 3 and pip
RUN apk add --no-cache python3 py3-pip

# Install pymongo
RUN pip install pymongo

# Build the application
RUN npm run build

# Set the command to run the application
CMD ["npm", "start"]
