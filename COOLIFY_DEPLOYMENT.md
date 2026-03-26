# WallDecor App — Coolify Deployment Guide

**Target:** `app.walldecor.pl` on OVH VPS (51.83.197.9)

---

## 📋 Pre-Deployment Checklist

- [x] Coolify installed on VPS
- [x] GitHub PAT token configured in Coolify
- [x] SSH key added to Coolify
- [x] Project on GitHub: `https://github.com/peterlesniewski-lang/walldecor-app.git`
- [x] Environment variables prepared

---

## 🚀 Deployment Steps

### Step 1: Add Application to Coolify

1. **Log in to Coolify** → `http://51.83.197.9:3000` (or configured URL)
2. **Create New Application:**
   - Name: `walldecor-app`
   - Source: GitHub
   - Repository: `peterlesniewski-lang/walldecor-app`
   - Branch: `main`
   - Build method: `Dockerfile` (already in repo)

### Step 2: Configure Environment Variables

In Coolify Application Settings → **Environment Variables**, add:

```
DATABASE_URL=file:/data/walldecor.db
NEXTAUTH_URL=https://app.walldecor.pl
NEXTAUTH_SECRET=sXuuOxwSXLrlq0GYSGqj7zMzUTHJyd2nyQMdf7cJkms=
ADMIN_EMAIL=piotr.lesniewski@walldecor.pl
ADMIN_PASSWORD=Wiosna1984$
NODE_ENV=production
```

### Step 3: Configure Custom Domain

1. **Coolify Dashboard** → Application → **Domain**
2. Add domain: `app.walldecor.pl`
3. Enable **SSL Certificate** (auto-generated via Let's Encrypt)

### Step 4: Configure Port & Reverse Proxy

- **Port:** 3000 (default for Next.js)
- **Reverse proxy:** Coolify will auto-configure Traefik
- **Healthcheck:** `/api/health` (already configured in docker-compose.yml)

### Step 5: Deploy

1. Click **Deploy** button
2. Coolify will:
   - Clone repository from GitHub
   - Install dependencies (`npm install`)
   - Build Next.js app (`npm run build`)
   - Build Docker image
   - Start container with volume for database
   - Configure reverse proxy & SSL

### Step 6: Verify Deployment

```bash
# SSH into VPS
ssh ubuntu@51.83.197.9

# Check container status
docker ps | grep walldecor-app

# Check logs
docker logs -f [container-id]

# Test health endpoint
curl https://app.walldecor.pl/api/health
```

---

## 🔍 Post-Deployment Checks

- [ ] Admin login works: `piotr.lesniewski@walldecor.pl` / `Wiosna1984$`
- [ ] Sidebar appears with dark theme
- [ ] Database seeded with default data (3 cost centers, 9 categories, 66 subcategories)
- [ ] SSL certificate valid on `app.walldecor.pl`
- [ ] Health check endpoint returns 200

---

## 📊 Database Persistence

- **Location:** `/data/walldecor.db` (Coolify volume mount)
- **Backup:** Database persists across container restarts
- **Prisma migrations:** Auto-run on container start (if configured in docker-entrypoint.sh)

---

## 🔧 Useful Coolify Commands

```bash
# SSH into VPS
ssh ubuntu@51.83.197.9

# View all Coolify-managed containers
docker ps --filter "label=com.docker.compose.project"

# View application logs in real-time
docker logs -f walldecor-app

# Access SQLite database directly
docker exec -it walldecor-app sqlite3 /data/walldecor.db

# Restart application
docker restart walldecor-app

# Prune old images after deployment
docker image prune -a --force
```

---

## 🆘 Troubleshooting

### Application won't start
```bash
# Check Docker build logs
docker logs [container-id]

# Ensure environment variables are set
docker exec walldecor-app env | grep NEXTAUTH
```

### Database issues
```bash
# Check if volume is mounted
docker inspect walldecor-app | grep Mounts

# Verify database file exists
docker exec walldecor-app ls -la /data/
```

### SSL certificate issues
- Coolify auto-renews Let's Encrypt certificates
- Check Traefik dashboard: `http://51.83.197.9:8080` (if exposed)

---

## 📈 Monitoring & Logs

Coolify provides built-in monitoring:
- **CPU/Memory:** Real-time resource usage
- **Logs:** Stream application output
- **Health checks:** Automated endpoint monitoring

---

## 🔄 Redeploy on GitHub Push

Once deployed, Coolify can auto-redeploy on GitHub push:
1. **Coolify Settings** → **Webhooks**
2. Add GitHub webhook: `https://coolify.example.com/webhooks/github`
3. On each `git push origin main`, Coolify automatically redeploys

---

## 📱 Next Steps

After deployment, next milestones:
- **M2:** Budget planning interface
- **M3:** Budget execution & revenue input
- **M4:** KPI dashboard with live data
- **M5:** Payment alerts and reminders

See `project_status.md` for full roadmap.
