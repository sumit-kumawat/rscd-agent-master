import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Server, Briefcase, ScrollText, Loader2 } from 'lucide-react';
import api from '../api';
import { useSearch } from '../context/SearchContext';

const typeIcon = {
  vm: Server,
  job: Briefcase,
  log: ScrollText,
};

export default function GlobalSearch() {
  const { search, setSearch } = useSearch();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const nav = useNavigate();
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.get(`/search?q=${encodeURIComponent(q)}`);
        setResults(r.results || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (item) => {
    setOpen(false);
    if (item.type === 'vm') {
      setSearch(item.label);
      nav('/vms');
    } else if (item.type === 'job') {
      nav(`/jobs/${item.id}`);
    } else {
      setSearch(item.label);
      nav('/logs');
    }
  };

  const showDropdown = open && search.trim().length > 0;

  return (
    <div className="global-search" ref={wrapRef}>
      <Search size={16} strokeWidth={1.5} className="global-search-icon" aria-hidden />
      <input
        className="input global-search-input"
        placeholder="Search hosts, jobs, logs…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => { if (search.trim()) setOpen(true); }}
        aria-label="Global search"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
      />
      {loading && <Loader2 size={14} className="global-search-spinner spin" aria-hidden />}
      {showDropdown && (
        <div className="global-search-dropdown" role="listbox">
          {loading && results.length === 0 ? (
            <div className="global-search-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="global-search-empty">No matches for &ldquo;{search}&rdquo;</div>
          ) : (
            results.map((item) => {
              const Icon = typeIcon[item.type] || Server;
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  className="global-search-item"
                  role="option"
                  onClick={() => pick(item)}
                >
                  <Icon size={15} className={`global-search-item-icon type-${item.type}`} />
                  <div className="global-search-item-text">
                    <span className="global-search-item-label">{item.label}</span>
                    {item.sub && <span className="global-search-item-sub">{item.sub}</span>}
                  </div>
                  <span className="global-search-item-type">{item.type}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
