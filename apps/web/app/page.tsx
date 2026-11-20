import Image from "next/image";
import {
  AppsIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  DeviceDesktopIcon,
  DownloadIcon,
  FileDiffIcon,
  FileDirectoryIcon,
  GitPullRequestIcon,
  HistoryIcon,
  KeyIcon,
  LockIcon,
  MarkGithubIcon,
  PersonIcon,
  RepoIcon,
  ServerIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "@primer/octicons-react";
import { CopyCommand } from "./components/CopyCommand";
import { DownloadButton } from "./components/DownloadButton";
import { ScreenshotTour, type Slide } from "./components/ScreenshotTour";
import { downloads, site, type Platform } from "./site";
import styles from "./page.module.css";
import repositories from "../public/screenshots/repositories.png";
import mismatch from "../public/screenshots/repository-mismatch.png";
import reviewFix from "../public/screenshots/review-fix.png";
import profiles from "../public/screenshots/profiles.png";
import sshKeys from "../public/screenshots/ssh-keys.png";
import hosts from "../public/screenshots/hosts.png";
import folderRules from "../public/screenshots/folder-rules.png";

const features = [
  {
    icon: PersonIcon,
    title: "One profile per account",
    body: "Bundle a GitHub username, commit author, email and SSH key into a profile for work, personal or client accounts.",
  },
  {
    icon: FileDirectoryIcon,
    title: "Folder rules",
    body: "Assign a folder to a profile once. Every repository inside it commits with the right name and email automatically.",
  },
  {
    icon: RepoIcon,
    title: "Repository inspector",
    body: "See the commit author, the SSH host and the GitHub account a repository will push with, and where each setting comes from.",
  },
  {
    icon: GitPullRequestIcon,
    title: "One-click remote fix",
    body: "Spot a repository pointing at the wrong account and preview the exact remote change before you apply it.",
  },
  {
    icon: KeyIcon,
    title: "SSH key manager",
    body: "Generate Ed25519 keys, copy public keys to GitHub, and load or unload them from your SSH agent.",
  },
  {
    icon: CheckCircleIcon,
    title: "Verified connections",
    body: "Test a profile and confirm which GitHub account actually authenticates, not just that a connection works.",
  },
];

const slides: Slide[] = [
  {
    id: "repositories",
    label: "Repositories",
    title: "Know who you are before you push",
    body: "Repositories are grouped by profile. Each shows its commit author and the GitHub account that answers for its remote.",
    image: repositories,
    alt: "Vexo repository inspector showing a verified GitHub connection",
  },
  {
    id: "mismatch",
    label: "Catch mistakes",
    title: "Wrong account? You will see it",
    body: "When a repository's remote does not match its folder's profile, Vexo flags it and offers a fix.",
    image: mismatch,
    alt: "A repository warning that its remote uses the wrong SSH host",
  },
  {
    id: "review",
    label: "Review changes",
    title: "Every change is a reviewed diff",
    body: "Vexo shows the exact lines it will write. Nothing changes until you apply, and Undo restores the previous files.",
    image: reviewFix,
    alt: "Review dialog showing a remote URL change as a diff",
  },
  {
    id: "profiles",
    label: "Profiles",
    title: "All your GitHub identities in one place",
    body: "Create a profile, generate its key, add it to GitHub, and verify the account in a single flow.",
    image: profiles,
    alt: "Profiles page with a verified Acme Corp profile",
  },
  {
    id: "keys",
    label: "SSH keys",
    title: "Keys you can trust yourself with",
    body: "See fingerprints, agent status and which hosts use each key. Keys still in use cannot be deleted by accident.",
    image: sshKeys,
    alt: "SSH keys page listing Ed25519 keys and their usage",
  },
  {
    id: "hosts",
    label: "Hosts",
    title: "Servers and aliases, side by side",
    body: "Hosts you wrote by hand are listed next to the ones Vexo manages, so you always see the full picture.",
    image: hosts,
    alt: "Hosts page with SSH aliases",
  },
  {
    id: "folders",
    label: "Folder rules",
    title: "Set it once per folder",
    body: "Folder rules use Git's conditional includes, so they work in every Git tool, not only in Vexo.",
    image: folderRules,
    alt: "Folder rules page mapping folders to profiles",
  },
];

const safety = [
  {
    icon: FileDiffIcon,
    title: "Review before write",
    body: "Every edit to your SSH or Git configuration is previewed as a diff first.",
  },
  {
    icon: HistoryIcon,
    title: "Undo last change",
    body: "Restore the previous files in one click. Vexo checks for newer edits first.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Your config stays yours",
    body: "Hand-written hosts are kept intact, and keys used by any host are protected from deletion.",
  },
  {
    icon: LockIcon,
    title: "Local only",
    body: "No account, no cloud, no telemetry. Keys never leave your SSH folder.",
  },
];

const steps = [
  {
    title: "Create a profile",
    body: "Add your work account, generate an Ed25519 key, and copy the public key to GitHub.",
    code: "Host github-work\n  HostName github.com\n  IdentityFile ~/.ssh/id_ed25519_work",
  },
  {
    title: "Assign a folder",
    body: "Point ~/Work at the profile. Repositories inside it commit as your work identity.",
    code: '[includeIf "gitdir:~/Work/"]\n  path = work.gitconfig',
  },
  {
    title: "Clone and push",
    body: "Clone through Vexo and the right alias is set for you. Your personal setup keeps working as before.",
    code: "git clone git@github-work:acme/api.git",
  },
];

const platforms: { id: Platform; icon: typeof KeyIcon; install: string }[] = [
  {
    id: "mac",
    icon: DeviceDesktopIcon,
    install:
      "Open the .dmg and drag Vexo to Applications. On first launch, right-click Vexo and choose Open.",
  },
  {
    id: "windows",
    icon: AppsIcon,
    install:
      "Run the installer. Needs Git for Windows; OpenSSH is built into Windows 10 and 11.",
  },
  {
    id: "linux",
    icon: TerminalIcon,
    install:
      "Install the .deb with apt, or make the AppImage executable and run it.",
  },
];

const faqs = [
  {
    q: "Will it change my existing GitHub setup?",
    a: "No. Vexo only reads your configuration until you apply a reviewed change. Your default github.com host, personal email and existing repositories keep working.",
  },
  {
    q: "Can I keep cloning over HTTPS?",
    a: "Yes. HTTPS uses tokens, not SSH, and Vexo never touches your credentials. Many people keep their personal account on HTTPS and use profiles for the others.",
  },
  {
    q: "What does it write to disk?",
    a: "An included SSH hosts file, a short Include at the top of ~/.ssh/config, and a Git include for folder rules. Each is shown as a diff before it is written.",
  },
  {
    q: "Which platforms are supported?",
    a: "macOS 11 or newer (Apple Silicon and Intel), Windows 10 and 11 (64-bit), and Linux as a .deb for Ubuntu and Debian or an AppImage for other distributions.",
  },
  {
    q: "Why does my computer warn me when I open it?",
    a: "Vexo is free and open source, and it is not registered with Apple or Microsoft yet, so your computer asks you to confirm the first time. On macOS, right-click Vexo in Applications and choose Open. On Windows, choose More info, then Run anyway. You only need to do this once.",
  },
];

// Flat brand mark (two branches merging), drawn in the current text color.
function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={styles.mark}
    >
      <path
        d="M6.5 6.5 L10.9 15.3 M17.5 6.5 L13.1 15.3"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="6.5" cy="6.5" r="2.4" fill="currentColor" />
      <circle cx="17.5" cy="6.5" r="2.4" fill="currentColor" />
      <circle cx="12" cy="17.5" r="2.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function Logo({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/logo.svg"
      alt=""
      width={size}
      height={size}
      className={styles.logo}
    />
  );
}

// Structured data for search engines (schema.org).
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.name,
    description: site.description,
    url: site.url,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS 11+, Windows 10, Windows 11, Linux",
    softwareVersion: site.version,
    downloadUrl: Object.values(downloads).flatMap((group) =>
      group.files.map((file) => file.url),
    ),
    image: `${site.url}/opengraph-image.png`,
    screenshot: slides.map((slide) => `${site.url}${slide.image.src}`),
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Person", name: site.author.name, url: site.author.url },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  },
];

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Primary">
          <a className={styles.brand} href="#top">
            <Mark />
            <span>{site.name}</span>
          </a>
          <div className={styles.navLinks}>
            <a href="#features">Features</a>
            <a href="#tour">Tour</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className={styles.navActions}>
            <a
              className={styles.iconLink}
              href={site.repo}
              aria-label="Vexo on GitHub"
            >
              <MarkGithubIcon size={20} />
            </a>
            <a className={`${styles.btn} ${styles.btnSmall}`} href="#download">
              Download
            </a>
          </div>
        </nav>
      </header>

      <main id="main">
        <section id="top" className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.container}>
            <a className={styles.pill} href="#download">
              <span className={styles.pillLabel}>New</span>
              {site.name} {site.version} for macOS, Windows and Linux
              <ArrowRightIcon size={14} />
            </a>
            <h1 className={styles.heroTitle}>
              Every GitHub account.
              <br />
              <span className={styles.gradientText}>
                The right key. Every time.
              </span>
            </h1>
            <p className={styles.heroLead}>
              {site.name} manages SSH keys, GitHub profiles and commit authors on
              your desktop, so work code never ships from your personal account
              again.
            </p>
            <div className={styles.heroActions}>
              <DownloadButton
                downloads={downloads}
                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLarge}`}
              />
              <a
                className={`${styles.btn} ${styles.btnLarge}`}
                href={site.repo}
              >
                <MarkGithubIcon size={20} />
                View on GitHub
              </a>
            </div>
            <p className={styles.heroMeta}>
              Free and open source · v{site.version} ·{" "}
              <a href="#download">macOS, Windows and Linux</a>
            </p>
            <div className={`${styles.window} ${styles.heroWindow}`}>
              <div className={styles.windowBar} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <Image
                src={repositories}
                alt="Vexo showing a repository with its commit author and verified GitHub account"
                sizes="(max-width: 1240px) 100vw, 1200px"
                placeholder="blur"
                priority
                className={styles.windowImage}
              />
            </div>
          </div>
        </section>

        <section className={styles.problem}>
          <div className={styles.container}>
            <p className={styles.problemText}>
              Two GitHub accounts on one laptop usually means editing{" "}
              <code>~/.ssh/config</code> by hand, guessing which key the agent
              offers, and finding out you committed with the wrong email{" "}
              <em>after</em> you pushed. {site.name} makes it visible and
              fixable.
            </p>
          </div>
        </section>

        <section id="features" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>
              <TerminalIcon size={16} /> Features
            </p>
            <h2 className={styles.sectionTitle}>
              Everything you need to juggle accounts
            </h2>
            <p className={styles.sectionLead}>
              Built on the tools you already use: OpenSSH, Git and your SSH agent.
              No wrappers and no lock-in.
            </p>
            <ul className={styles.featureGrid}>
              {features.map(({ icon: Icon, title, body }) => (
                <li key={title} className={styles.card}>
                  <span className={styles.cardIcon}>
                    <Icon size={20} />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="tour" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>
              <RepoIcon size={16} /> Product tour
            </p>
            <h2 className={styles.sectionTitle}>See it in action</h2>
            <ScreenshotTour slides={slides} />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <div className={styles.safety}>
              <div>
                <p className={styles.eyebrow}>
                  <ShieldCheckIcon size={16} /> Safe by design
                </p>
                <h2 className={styles.sectionTitle}>
                  Your config. Never a surprise.
                </h2>
                <p className={styles.sectionLead}>
                  {site.name} edits the same files you would, but shows you
                  every line first and lets you take it back.
                </p>
              </div>
              <ul className={styles.safetyGrid}>
                {safety.map(({ icon: Icon, title, body }) => (
                  <li key={title}>
                    <Icon size={20} className={styles.safetyIcon} />
                    <div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how" className={styles.section}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>
              <ServerIcon size={16} /> How it works
            </p>
            <h2 className={styles.sectionTitle}>Set up a second account in minutes</h2>
            <ol className={styles.steps}>
              {steps.map((step, i) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.stepNumber}>{i + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <pre>
                    <code>{step.code}</code>
                  </pre>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="download" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.download}>
              <div className={styles.downloadGlow} aria-hidden="true" />
              <Logo size={88} />
              <h2 className={styles.sectionTitle}>Download {site.name}</h2>
              <p className={styles.sectionLead}>
                Version {site.version}. Free for macOS, Windows and Linux.
                Requires Git and OpenSSH.
              </p>
              <div className={styles.platforms}>
                {platforms.map(({ id, icon: Icon, install }) => (
                  <section key={id} className={styles.platform}>
                    <h3>
                      <Icon size={20} />
                      {downloads[id].name}
                    </h3>
                    <div className={styles.platformFiles}>
                      {downloads[id].files.map((file, i) => (
                        <a
                          key={file.file}
                          href={file.url}
                          className={`${styles.btn} ${i === 0 ? styles.btnPrimary : ""} ${styles.platformButton}`}
                        >
                          <DownloadIcon size={16} />
                          <span>
                            {file.label}
                            <small>{file.detail}</small>
                          </span>
                        </a>
                      ))}
                    </div>
                    <p className={styles.platformInstall}>{install}</p>
                  </section>
                ))}
              </div>
              <div className={styles.install}>
                <p>Ubuntu or Debian: install from the folder you downloaded it to.</p>
                <CopyCommand command={`sudo apt install ./${site.debFile}`} />
              </div>
              <p className={styles.downloadNote}>
                Looking for an older version? See{" "}
                <a href={site.releases}>all releases</a>.
              </p>
            </div>
          </div>
        </section>

        <section id="faq" className={styles.section}>
          <div className={`${styles.container} ${styles.narrow}`}>
            <h2 className={styles.sectionTitle}>Questions</h2>
            <div className={styles.faq}>
              {faqs.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <a className={styles.brand} href="#top">
            <Mark size={22} />
            <span>{site.name}</span>
          </a>
          <p>Local SSH and Git identity manager. Free and open source.</p>
          <a href={site.repo}>GitHub</a>
        </div>
      </footer>
    </>
  );
}
