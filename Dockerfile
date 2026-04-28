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

# Inject Railway environment variables for Vite build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BACKEND_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

RUN npm run build

EXPOSE 8080

CMD ["npm", "start"]
