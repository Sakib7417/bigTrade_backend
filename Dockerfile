FROM node:20-alpine

# Prisma engines need openssl + libc compat on Alpine (musl)
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN npx prisma generate

EXPOSE 5000

CMD ["node", "src/server.js"]
