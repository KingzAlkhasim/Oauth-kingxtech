# 1. Use the official lightweight Node image
FROM node:24-alpine

# 2. Create and set the working directory
WORKDIR /usr/src/app

# 3. Copy package files and install ALL dependencies (including devDependencies like typescript)
COPY package*.json ./
RUN npm ci

# 4. Copy the rest of your backend source code
COPY . .

# 5. Build the TypeScript files into JavaScript
RUN npm run build

# 6. Prune devDependencies to keep the final deployment image lightweight
RUN npm prune --production

# 7. Expose the port your server listens on (Cloud Run defaults to 8080)
EXPOSE 8080

# 8. Start the server
CMD [ "npm", "start" ]

