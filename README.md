# 🎓 InternFlow

A high-performance, mobile-responsive internship management system designed to streamline time tracking, DTR (Daily Time Record) generation, and student progress monitoring.

![Aesthetics](https://img.shields.io/badge/Aesthetics-Premium-orange?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-Astro%20%7C%20Supabase%20%7C%20Google%20OAuth-blue?style=for-the-badge)

## 🚀 Overview

This platform serves as a unified bridge between **Interns (Students)** and **OJT Coordinators**. It automates the tedious process of calculating internship hours, managing allowance expectations, and generating professional documentation required for graduation and certification.

### 🌟 Key Features

#### 👨‍🎓 For Students (Interns)
- **Hybrid Time Tracking**: Track hours via a built-in stopwatch or sync seamlessly with a professional **Clockify** workspace.
- **Smart DTR Generator**: Generate 8.5"x11" professional DTR sheets automatically grouped into AM/PM sessions with intelligent gap detection.
- **Progress Analytics**: Real-time visualization of rendered hours, target completion percentage, and estimated completion dates.
- **Financial Tracking**: Automatic calculation of allowances based on hourly or daily rates.

#### 👨‍🏫 For OJT Coordinators
- **Centralized Roster**: View all assigned students in a single high-visibility dashboard.
- **Advanced Filtering**: Narrow down rosters by **Cooperating Agency** or **Completion Status** (Completed vs. In Progress).
- **One-Click Audits**: Instantly view and verify any student's DTR sheet and time logs.
- **Invite System**: Manage student onboarding via secure, unique coordinator invite codes.

## 🛠️ Tech Stack

- **Framework**: [Astro](https://astro.build/) (Static Site Generation + Server-Side Rendering)
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL + Google OAuth)
- **Styling**: Vanilla CSS with a focus on **Rich Aesthetics**, Glassmorphism, and full Mobile Responsiveness.
- **External API**: [Clockify API](https://clockify.me/developers-api) for professional workspace synchronization.

## 📂 Project Structure

```text
/
├── src/
│   ├── components/     # Reusable UI components (Sidebar, Header, etc.)
│   ├── lib/            # Core logic (Auth, Entries, Settings, DTR Grouping)
│   ├── pages/          # Application routes (Dashboard, DTR, Tracker, Coordinator)
│   └── layouts/        # Global page wrappers
├── public/             # Static assets (Logos, Icons)
├── supabase_schema.sql # Database blueprint for production
└── .env.example        # Configuration template
```

## ⚙️ Setup & Installation

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd calcAllowance
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file based on `.env.example`:
   - `PUBLIC_SUPABASE_URL` & `PUBLIC_SUPABASE_ANON_KEY`
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`
   - `CLOCKIFY_API_KEY` & `CLOCKIFY_WORKSPACE_ID` (Optional)

4. **Initialize Database**:
   Run the contents of `supabase_schema.sql` in your Supabase SQL Editor.

5. **Start Development**:
   ```bash
   bun run dev
   ```

## 📱 Mobile Experience

The platform is designed with a **Mobile-First** approach. The navigation sidebar collapses into a sleek mobile menu, and all data-heavy tables utilize horizontal scroll containers to ensure 100% usability on smartphones and tablets.

---

*Built with passion for efficient internship management.*
