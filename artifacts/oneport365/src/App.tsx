export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#1C3829',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <div style={{
          width: 56, height: 56,
          background: '#7AB648',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color: '#fff',
          margin: '0 auto 20px',
        }}>
          O
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
          OnePort <span style={{ color: '#7AB648' }}>365</span>
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.05em' }}>
          RFQ Operations Suite — Demo
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href="/outlook_scan.html" style={{
          display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: '24px 28px',
          cursor: 'pointer', textDecoration: 'none',
          transition: 'all 0.15s',
          width: 220,
        }}
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
          onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <div style={{ fontSize: 22, marginBottom: 10 }}>📬</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
            RFQ Intake
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
            Monitor the commercial inbox, extract fields from customer emails, and track RFQ status.
          </div>
          <div style={{
            marginTop: 18, fontSize: 11, color: '#7AB648', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            Open → 
          </div>
        </a>

        <a href="/rfq_pipeline.html" style={{
          display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: '24px 28px',
          cursor: 'pointer', textDecoration: 'none',
          transition: 'all 0.15s',
          width: 220,
        }}
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
          onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <div style={{ fontSize: 22, marginBottom: 10 }}>⚡</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
            RFQ Pipeline
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
            4-step workflow: extract RFQ → request rates → parse vendor reply → generate quote.
          </div>
          <div style={{
            marginTop: 18, fontSize: 11, color: '#7AB648', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            Open →
          </div>
        </a>

        {/* MVP 1 card */}
        <a href="/outlook_scan.html" style={{
          display: 'flex', flexDirection: 'column',
          background: 'rgba(212,225,0,0.05)',
          border: '2px solid #D4E100',
          borderRadius: 12, padding: '24px 28px',
          cursor: 'pointer', textDecoration: 'none',
          transition: 'all 0.15s',
          width: 220,
        }}
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(212,225,0,0.1)')}
          onMouseOut={e => (e.currentTarget.style.background = 'rgba(212,225,0,0.05)')}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#D4E100',
              background: 'rgba(212,225,0,0.15)',
              border: '1px solid rgba(212,225,0,0.4)',
              padding: '2px 8px', borderRadius: 20,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>MVP 1</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
            RFQ Intake
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
            Email categorisation, field extraction, missing-info detection &amp; automated follow-up drafting.
          </div>
          <div style={{
            marginTop: 18, fontSize: 11, color: '#D4E100', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            Open →
          </div>
        </a>
      </div>

      <div style={{ marginTop: 48, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        Powered by Claude AI
      </div>
    </div>
  );
}
