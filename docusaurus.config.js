import {themes as prismThemes} from 'prism-react-renderer';

const config = {
  title: 'Finance Analyst Hub',
  tagline: 'Investment Research · Valuation Models · Market Intelligence',
  favicon: 'img/favicon.ico',
  url: 'https://finance-docs.vercel.app',
  baseUrl: '/',
  organizationName: 'Finance-User-Mike',
  projectName: 'finance-docs',
  trailingSlash: false,
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  markdown: { format: 'detect' },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    ['classic', {
      docs: { sidebarPath: './sidebars.js', routeBasePath: 'docs' },
      blog: { showReadingTime: true },
      theme: { customCss: './src/css/custom.css' },
    }],
  ],
  themeConfig: {
    navbar: {
      title: 'Finance Analyst Hub',
      items: [
        { type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Docs' },
        
        { href: 'https://github.com/Finance-User-Mike/finance-docs', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Finance Analyst Hub.`,
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
  },
};

export default config;
