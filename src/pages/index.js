import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title="SiMa — Signal Market" description="Automated TQQQ trading system">
      <main style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a2d6e 0%, #1a5276 60%, #2471a3 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}>
        <div style={{maxWidth: '780px', width: '100%', textAlign: 'center', color: '#fff'}}>

          {/* Logo */}
          <img src="/img/sima-logo.svg" alt="SiMa Logo"
            style={{width: '120px', height: '120px', marginBottom: '1.5rem'}}/>

          {/* Title */}
          <h1 style={{fontSize: '3rem', fontWeight: '700', marginBottom: '0.5rem', color: '#fff'}}>
            SiMa
          </h1>
          <p style={{fontSize: '1.1rem', color: '#5dade2', letterSpacing: '3px', marginBottom: '1rem', textTransform: 'uppercase'}}>
            Signal · Market · Automation
          </p>

          {/* Divider */}
          <div style={{width: '60px', height: '3px', background: '#5dade2', margin: '0 auto 2rem'}}/>

          {/* Description */}
          <p style={{fontSize: '1.15rem', lineHeight: '1.8', color: '#d6eaf8', marginBottom: '1rem'}}>
            An automated TQQQ trading system that evaluates daily market signals using momentum indicators, executes trades through Interactive Brokers, and manages risk with dynamic ratchet stops.
          </p>
          <p style={{fontSize: '1rem', lineHeight: '1.8', color: '#aed6f1', marginBottom: '2.5rem'}}>
            Built for systematic, rules-based trading — no emotion, no manual intervention. The system runs 24/7, monitors positions, and shuts down safely on any anomaly.
          </p>

          {/* Feature pills */}
          <div style={{display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '3rem'}}>
            {['TQQQ Strategy', 'IB Gateway', 'Backtest Engine', 'Circuit Breaker', 'Live Trading', 'Signal Validation'].map(f => (
              <span key={f} style={{
                background: 'rgba(93,173,226,0.15)',
                border: '1px solid rgba(93,173,226,0.4)',
                borderRadius: '20px',
                padding: '6px 16px',
                fontSize: '0.85rem',
                color: '#aed6f1',
              }}>{f}</span>
            ))}
          </div>

          {/* CTA Button */}
          <Link to="/docs/Strategy-Logic" style={{
            display: 'inline-block',
            background: '#5dade2',
            color: '#0a2d6e',
            padding: '14px 40px',
            borderRadius: '8px',
            fontWeight: '700',
            fontSize: '1rem',
            textDecoration: 'none',
            marginRight: '12px',
            letterSpacing: '0.5px',
          }}>
            View Documentation →
          </Link>
          <Link to="/docs/System-Architecture" style={{
            display: 'inline-block',
            background: 'transparent',
            color: '#5dade2',
            padding: '14px 40px',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '1rem',
            textDecoration: 'none',
            border: '1px solid #5dade2',
          }}>
            System Architecture
          </Link>

          {/* Footer note */}
          <p style={{marginTop: '3rem', fontSize: '0.8rem', color: '#5d8aa8'}}>
            Finance-User-Mike · Built with Docusaurus · Deployed on Vercel
          </p>
        </div>
      </main>
    </Layout>
  );
}
