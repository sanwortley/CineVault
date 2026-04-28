FROM node:22-slim

# Install FFmpeg and ffprobe
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Install ALL dependencies (including devDependencies like Vite needed for build)
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8080

CMD ["npm", "start"]
