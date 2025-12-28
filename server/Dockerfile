FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for tsx)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript (if needed, or use tsx for runtime)
# RUN npm run build

# Expose port
EXPOSE 3001

# Start server
CMD ["npm", "start"]

