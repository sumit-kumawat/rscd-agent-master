import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, ChevronRight, ChevronLeft, Package, Trash2, Shield, AlertTriangle, Loader2,
} from 'lucide-react';
import api from '../api';
import { useToast } from './Toast';
import Portal from './Portal';
import { useEnvironment } from '../context/EnvironmentContext';
import { TableSkeleton } from './ui/TabSkeletons';

const MSI_DEFAULT_ARGS = '/qn /norestart';

export default function DeployWizard({ endpoints, onClose }) {
  const { environment, isProd } = useEnvironment();
  const toast = useToast();
  const nav = useNavigate();
  const [operation, setOperation] = useState('uninstall');
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVersions, setSelectedVersions] = useState([]);
  const [target, setTarget] = useState('rscd');
  const [packageFile, setPackageFile] = useState(null);
  const [packageMeta, setPackageMeta] = useState(null);
  const [installArgs, setInstallArgs] = useState(MSI_DEFAULT_ARGS);
  const [prodConfirm, setProdConfirm] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState('');

  const ids = useMemo(() => endpoints.map((e) => e._id), [endpoints]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.post('/deployments/programs/query', { endpointIds: ids, environment });
      const list = r.data?.products || [];
      setProducts(list);
      const rscd = list.find((p) => p.classification === 'rscd');
      if (rscd) {
        setSelectedProduct(rscd.productName);
        setTarget('rscd');
        setSelectedVersions([]);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [ids, environment, toast]);

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  useEffect(() => {
    if (operation === 'uninstall' && step === 2) loadProducts();
  }, [operation, step, loadProducts]);

  const uploadPackage = async () => {
    if (!packageFile) return null;
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', packageFile);
      form.append('name', packageFile.name);
      const r = await api.upload('/packages/upload', form, 300000);
      setPackageMeta(r.data);
      return r.data;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const startJob = async () => {
    setLoading(true);
    try {
      if (isProd && prodConfirm !== 'PROD') {
        toast('Type PROD to confirm production execution', 'error');
        return;
      }
      if (ids.length >= 20 && bulkConfirm !== String(ids.length)) {
        toast(`Type ${ids.length} to confirm bulk operation`, 'error');
        return;
      }
      let job;
      if (operation === 'install') {
        const pkg = packageMeta || await uploadPackage();
        if (!pkg?.id) return;
        job = await api.post('/deployments/install', {
          name: `Install — ${pkg.name}`,
          endpointIds: ids,
          environment,
          packageId: pkg.id,
          options: {
            installArgs,
            confirmedProd: isProd,
            bulkConfirmed: ids.length >= 20,
            productName: pkg.name,
          },
        });
      } else {
        const product = products.find((p) => p.productName === selectedProduct);
        const resolvedTarget = product?.classification === 'crowdstrike' ? 'crowdstrike'
          : (product?.classification === 'rscd' ? 'rscd' : 'custom');
        job = await api.post('/deployments/uninstall', {
          name: resolvedTarget === 'rscd' ? 'Uninstall RSCD' : `Uninstall — ${selectedProduct}`,
          endpointIds: ids,
          environment,
          target: resolvedTarget,
          productName: selectedProduct,
          productVersions: selectedVersions.length ? selectedVersions : undefined,
          options: {
            silent: true,
            stopService: true,
            confirmedProd: isProd,
            bulkConfirmed: ids.length >= 20,
          },
        });
      }
      const jobId = job.data?._id || job.job?._id;
      toast('Deployment job started', 'success');
      onClose();
      if (jobId) nav(`/jobs/${jobId}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const steps = operation === 'uninstall'
    ? ['Operation', 'Environment', 'Products', 'Versions', 'Review']
    : ['Operation', 'Environment', 'Package', 'Arguments', 'Review'];

  const next = async () => {
    if (operation === 'install' && step === 2 && !packageMeta && packageFile) {
      const ok = await uploadPackage();
      if (!ok) return;
    }
    if (step < steps.length - 1) setStep((s) => s + 1);
    else startJob();
  };

  const prev = () => setStep((s) => Math.max(0, s - 1));

  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (!loading && confirm('Close deployment wizard?')) onClose();
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); next(); }
  };

  return (
    <Portal>
      <div className="deploy-wizard-backdrop" onClick={() => !loading && onClose()} role="presentation">
        <div className="deploy-wizard" onClick={(e) => e.stopPropagation()} onKeyDown={onKey} tabIndex={-1}>
          <header className="deploy-wizard-header">
            <div>
              <h2>Deploy wizard</h2>
              <p>{endpoints.length} endpoint(s) selected · {environment.toUpperCase()}</p>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </header>

          <div className="deploy-wizard-steps">
            {steps.map((label, i) => (
              <span key={label} className={`deploy-step-pill${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>{label}</span>
            ))}
          </div>

          <div className="deploy-wizard-body">
            {step === 0 && (
              <div className="deploy-op-grid">
                <button type="button" className={`deploy-op-card${operation === 'uninstall' ? ' active' : ''}`} onClick={() => setOperation('uninstall')}>
                  <Trash2 size={24} strokeWidth={1.5} />
                  <strong>Uninstall programs</strong>
                  <span>RSCD, CrowdStrike, or custom products</span>
                </button>
                <button type="button" className={`deploy-op-card${operation === 'install' ? ' active' : ''}`} onClick={() => setOperation('install')}>
                  <Package size={24} strokeWidth={1.5} />
                  <strong>Install package</strong>
                  <span>MSI/EXE with SHA-256 verification</span>
                </button>
              </div>
            )}

            {step === 1 && (
              <div className="deploy-panel">
                {isProd && (
                  <div className="alert alert-danger">
                    <AlertTriangle size={16} /> Production environment — additional confirmation required on review.
                  </div>
                )}
                <p>Target environment: <strong>{environment.toUpperCase()}</strong></p>
                <p className="text-muted">Change environment using the header selector before starting the wizard.</p>
                <ul className="deploy-endpoint-list">
                  {endpoints.slice(0, 8).map((e) => (
                    <li key={e._id}>{e.name} <span className="mono">{e.ip || '—'}</span></li>
                  ))}
                  {endpoints.length > 8 && <li>…and {endpoints.length - 8} more</li>}
                </ul>
              </div>
            )}

            {operation === 'uninstall' && step === 2 && (
              <div className="deploy-panel">
                {loading ? <TableSkeleton rows={6} cols={3} /> : (
                  <div className="deploy-product-list">
                    {products.length === 0 ? (
                      <p className="empty">No programs detected — endpoints may be offline.</p>
                    ) : products.map((p) => (
                      <button
                        key={p.productName}
                        type="button"
                        className={`deploy-product-row${selectedProduct === p.productName ? ' active' : ''}`}
                        onClick={() => {
                          setSelectedProduct(p.productName);
                          setTarget(p.classification === 'rscd' ? 'rscd' : p.classification === 'crowdstrike' ? 'crowdstrike' : 'custom');
                          setSelectedVersions([]);
                        }}
                      >
                        <span className="deploy-product-name">
                          {p.classification === 'rscd' && <Shield size={14} />}
                          {p.productName}
                        </span>
                        <span>{p.endpointCount} hosts · {p.versionCount} versions</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {operation === 'uninstall' && step === 3 && (
              <div className="deploy-panel">
                <p>Select versions for <strong>{selectedProduct}</strong></p>
                <label className="field field-row">
                  <input type="checkbox" checked={!selectedVersions.length} onChange={() => setSelectedVersions([])} />
                  <span>All versions</span>
                </label>
                {(products.find((p) => p.productName === selectedProduct)?.versions || []).map((v) => (
                  <label key={v.version} className="field field-row">
                    <input
                      type="checkbox"
                      checked={selectedVersions.includes(v.version)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedVersions((s) => [...s, v.version]);
                        else setSelectedVersions((s) => s.filter((x) => x !== v.version));
                      }}
                    />
                    <span>{v.version} ({v.endpointCount} hosts)</span>
                  </label>
                ))}
              </div>
            )}

            {operation === 'install' && step === 2 && (
              <div className="deploy-panel">
                <label className="field"><span>Package (MSI/EXE)</span>
                  <input type="file" accept=".msi,.exe" onChange={(e) => { setPackageFile(e.target.files?.[0] || null); setPackageMeta(null); }} />
                </label>
                {packageMeta && (
                  <div className="deploy-sha">
                    <div>SHA-256: <code className="mono">{packageMeta.sha256}</code></div>
                    <div>Size: {(packageMeta.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                )}
              </div>
            )}

            {operation === 'install' && step === 3 && (
              <div className="deploy-panel">
                <label className="field"><span>Silent install arguments</span>
                  <input className="input" value={installArgs} onChange={(e) => setInstallArgs(e.target.value)} />
                </label>
                {packageFile?.name?.toLowerCase().endsWith('.exe') && (
                  <div className="alert alert-warning">EXE parameters are package-specific — verify with vendor documentation.</div>
                )}
              </div>
            )}

            {step === steps.length - 1 && (
              <div className="deploy-panel">
                <div className="deploy-review">
                  <div><span>Operation</span><strong>{operation}</strong></div>
                  <div><span>Environment</span><strong>{environment.toUpperCase()}</strong></div>
                  <div><span>Endpoints</span><strong>{endpoints.length}</strong></div>
                  {operation === 'uninstall' && (
                    <>
                      <div><span>Product</span><strong>{selectedProduct || '—'}</strong></div>
                      <div><span>Versions</span><strong>{selectedVersions.length ? selectedVersions.join(', ') : 'All'}</strong></div>
                    </>
                  )}
                  {operation === 'install' && (
                    <div><span>Package</span><strong>{packageMeta?.name || packageFile?.name || '—'}</strong></div>
                  )}
                </div>
                {isProd && (
                  <label className="field"><span>Type PROD to confirm</span>
                    <input className="input" value={prodConfirm} onChange={(e) => setProdConfirm(e.target.value)} />
                  </label>
                )}
                {endpoints.length >= 20 && (
                  <label className="field"><span>Type {endpoints.length} to confirm bulk operation</span>
                    <input className="input" value={bulkConfirm} onChange={(e) => setBulkConfirm(e.target.value)} />
                  </label>
                )}
              </div>
            )}
          </div>

          <footer className="deploy-wizard-footer">
            <button type="button" className="btn btn-outline" disabled={step === 0 || loading} onClick={prev}>
              <ChevronLeft size={14} /> Back
            </button>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={next}>
              {loading ? <Loader2 className="spin" size={14} /> : null}
              {step === steps.length - 1 ? 'Start job' : 'Next'}
              {step < steps.length - 1 && <ChevronRight size={14} />}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
}
