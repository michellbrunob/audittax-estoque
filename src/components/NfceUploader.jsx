import { useEffect, useMemo, useState } from 'react';

const API_BASE_URL = 'http://localhost:3333';
const UPLOAD_URL = `${API_BASE_URL}/nfce/upload`;
const HEALTH_URL = `${API_BASE_URL}/nfce/health`;

function DependencyStatus({ dependencies }) {
  const items = useMemo(() => {
    if (!dependencies) {
      return [];
    }

    return [
      {
        id: 'anthropic',
        label: 'Anthropic / Claude Vision',
        ready: dependencies.anthropic?.configured,
        data: dependencies.anthropic,
      },
      {
        id: 'tesseract',
        label: 'Tesseract OCR',
        ready: dependencies.tesseract?.installed,
        data: dependencies.tesseract,
      },
      {
        id: 'poppler',
        label: 'Poppler / pdftoppm',
        ready: dependencies.poppler?.installed,
        data: dependencies.poppler,
      },
    ];
  }, [dependencies]);

  if (!items.length) {
    return null;
  }

  return (
    <div style={styles.dependencyList}>
      {items.map((item) => (
        <div key={item.id} style={styles.dependencyCard}>
          <div style={styles.dependencyHead}>
            <strong>{item.label}</strong>
            <span style={item.ready ? styles.okBadge : styles.warnBadge}>
              {item.ready ? 'Pronto' : 'Pendente'}
            </span>
          </div>
          <p style={styles.dependencyMeta}>
            Necessario para: {(item.data?.requiredFor || []).join(', ') || 'uso geral'}
          </p>
          {item.data?.model ? <p style={styles.dependencyMeta}>Modelo: {item.data.model}</p> : null}
          {!item.ready && item.data?.installHint ? (
            <p style={styles.dependencyHint}>{item.data.installHint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function NfceUploader() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadHealth() {
      try {
        const response = await fetch(HEALTH_URL);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Nao foi possivel verificar o ambiente local.');
        }

        if (active) {
          setHealth(data);
          setHealthError('');
        }
      } catch (requestError) {
        if (active) {
          setHealthError(requestError.message || 'Falha ao consultar o backend.');
        }
      }
    }

    loadHealth();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setError('Selecione uma imagem ou PDF antes de enviar.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.dependencies) {
        setHealth((current) => ({
          ...(current || {}),
          dependencies: data.dependencies,
          status: current?.status || 'warning',
        }));
      }

      if (!response.ok) {
        throw new Error(data.error || 'Falha ao extrair a chave da NFC-e.');
      }

      setResult(data);
    } catch (submitError) {
      setError(submitError.message || 'Erro inesperado ao enviar o arquivo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={styles.wrapper}>
      <div style={styles.header}>
        <h3 style={styles.title}>Extrator de Chave NFC-e</h3>
        <p style={styles.subtitle}>Fluxo priorizado: QR Code, PDF com texto, Claude Vision e OCR local.</p>
      </div>

      {health ? (
        <div style={health.status === 'ok' ? styles.healthOk : styles.healthWarn}>
          <strong>Diagnostico do ambiente</strong>
          <p style={styles.healthText}>{health.message}</p>
          <DependencyStatus dependencies={health.dependencies} />
        </div>
      ) : null}

      {healthError ? <div style={styles.errorBox}>{healthError}</div> : null}

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Enviando...' : 'Enviar'}
        </button>
      </form>

      {result ? (
        <div style={styles.successBox}>
          <p><strong>Chave:</strong> {result.chaveAcesso}</p>
          <p><strong>Fonte:</strong> {result.fonte}</p>
          <p><strong>Confianca:</strong> {result.confianca || 'media'}</p>
          <p><strong>Candidatas:</strong> {(result.candidatas || []).join(', ') || 'Nenhuma'}</p>
        </div>
      ) : null}

      {error ? <div style={styles.errorBox}>{error}</div> : null}
    </section>
  );
}

const styles = {
  wrapper: {
    border: '1px solid rgba(23,40,63,.12)',
    borderRadius: 18,
    padding: 24,
    background: '#fff',
    display: 'grid',
    gap: 16,
  },
  header: {
    display: 'grid',
    gap: 6,
  },
  title: {
    margin: 0,
    color: '#17283f',
  },
  subtitle: {
    margin: 0,
    color: '#607086',
  },
  form: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  button: {
    borderRadius: 12,
    border: '1px solid #17283f',
    background: '#17283f',
    color: '#fff',
    padding: '10px 14px',
    cursor: 'pointer',
  },
  healthOk: {
    borderRadius: 14,
    padding: 16,
    background: '#eef8f3',
    color: '#17283f',
    display: 'grid',
    gap: 10,
  },
  healthWarn: {
    borderRadius: 14,
    padding: 16,
    background: '#fff4df',
    color: '#6e4c12',
    display: 'grid',
    gap: 10,
  },
  healthText: {
    margin: 0,
  },
  dependencyList: {
    display: 'grid',
    gap: 10,
  },
  dependencyCard: {
    border: '1px solid rgba(23,40,63,.12)',
    borderRadius: 12,
    background: '#fff',
    padding: 12,
    display: 'grid',
    gap: 6,
  },
  dependencyHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  dependencyMeta: {
    margin: 0,
    color: '#607086',
  },
  dependencyHint: {
    margin: 0,
    color: '#c74b43',
  },
  okBadge: {
    borderRadius: 999,
    background: '#e1f5ea',
    color: '#145a32',
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 700,
  },
  warnBadge: {
    borderRadius: 999,
    background: '#fde7bf',
    color: '#8a5a00',
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 700,
  },
  successBox: {
    borderRadius: 14,
    padding: 16,
    background: '#e9f7f1',
    color: '#17283f',
    display: 'grid',
    gap: 6,
  },
  errorBox: {
    borderRadius: 14,
    padding: 16,
    background: '#fdecea',
    color: '#c74b43',
  },
};
