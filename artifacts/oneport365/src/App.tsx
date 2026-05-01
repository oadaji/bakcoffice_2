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

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* RFQ INTAKE — MVP V1 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              color: '#7AB648', background: 'rgba(122,182,72,0.15)',
              border: '1px solid rgba(122,182,72,0.4)',
              padding: '3px 9px', borderRadius: 20,
              textTransform: 'uppercase',
            }}>
              ✦ MVP V1
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
              Building this first
            </span>
          </div>

          <a href="/outlook_scan.html" style={{
            display: 'flex', flexDirection: 'column',
            background: 'rgba(122,182,72,0.07)',
            border: '1px solid rgba(122,182,72,0.35)',
            borderRadius: 12, padding: '24px 28px',
            cursor: 'pointer', textDecoration: 'none',
            transition: 'all 0.15s',
            width: 220,
          }}
            onMouseOver={e => (e.currentTarget.style.background = 'rgba(122,182,72,0.13)')}
            onMouseOut={e => (e.currentTarget.style.background = 'rgba(122,182,72,0.07)')}
          >
            <div style={{ fontSize: 22, marginBottom: 10 }}>📬</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
              RFQ Intake
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
              Monitor the commercial inbox, extract fields from customer emails, and track RFQ status.
            </div>
            <div style={{
              marginTop: 14, paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,0.08)',
              fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6,
            }}>
              Scan emails · view body · filter non-RFQ · extract fields · WhatsApp intake
            </div>
            <div style={{
              marginTop: 14, fontSize: 11, color: '#7AB648', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              Open demo →
            </div>
          </a>
        </div>

        {/* RFQ PIPELINE — Planned */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              padding: '3px 9px', borderRadius: 20,
              textTransform: 'uppercase',
            }}>
              Planned
            </span>
          </div>

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
        </div>

      </div>

      <div style={{ marginTop: 48, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        Powered by Claude AI
      </div>
    </div>
  );
}
