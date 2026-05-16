# Fitchburg Line Train Timetable

A real-time train timetable web app for the MBTA Fitchburg Line, showing crossing times at Park Street in Somerville, MA.

## Features

- Real-time display of train crossing times
- Weekday and weekend schedules
- Direction filtering (outbound to Wachusett, inbound to North Station)
- Holiday schedule detection
- Responsive design with dark theme

## Local Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/train-timetable.git
   cd train-timetable
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
```

This creates a `dist/` folder with the production build.

## Deployment to GitHub Pages

### Initial Setup

1. **Authenticate with GitHub CLI** (if not already done):
   ```bash
   gh auth login
   ```

2. **Create the GitHub repository** (replace `yourusername`):
   ```bash
   gh repo create train-timetable --private --source=. --remote=origin --push
   ```

3. **Enable GitHub Pages**:
   - Go to your repository settings
   - Navigate to "Pages"
   - Set source to "GitHub Actions"
   - Click "Save"

The site will be automatically deployed when you push to the `main` branch.

### Updating the Site

To update the deployed site with new changes:

1. **Make your changes** to the code (e.g., update schedules, fix bugs, add features).

2. **Test locally**:
   ```bash
   npm run dev
   ```

3. **Build and test production version**:
   ```bash
   npm run build
   npm run preview
   ```

4. **Commit and push changes**:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin main
   ```

The GitHub Actions workflow will automatically build and deploy your changes to GitHub Pages.

### Manual Deployment

If you need to trigger a deployment manually (e.g., after config changes):

- Go to the "Actions" tab in your GitHub repository
- Click on the "Deploy to GitHub Pages" workflow
- Click "Run workflow"

### Important Notes

- **Schedule data is automatically updated daily** via GitHub Actions (every day at 2 AM UTC)
- If you need to manually update schedules, run: `node scripts/update-schedule.js`
- If you change the repository name, update the `base` in `vite.config.js` to match `/your-new-repo-name/`
- The app uses MBTA schedule data fetched from their public API

## Technologies Used

- React 18
- Vite
- GitHub Pages for hosting
- GitHub CLI for deployment

## License

This project is private. Contact the owner for access.