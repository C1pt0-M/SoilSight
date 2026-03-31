import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { shiService } from '../../services/shiService';
import { useMapStore } from '../../store/mapStore';
import './SearchBar.css';

interface SearchResult {
  name: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number];
  type: string;
}

const TYPE_LABELS: Record<string, string> = {
  prefecture: '地州',
  county: '县',
  coordinate: '坐标',
};

const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    try {
      const data = await shiService.searchLocation(q.trim());
      setResults(data);
      setShowDropdown(data.length > 0);
    } catch {
      setResults([]);
      setShowDropdown(false);
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  }, [doSearch]);

  const handleSelect = useCallback((result: SearchResult) => {
    let zoom: number;
    if (result.type === 'prefecture') {
      zoom = 8;
    } else if (result.type === 'county') {
      zoom = 10;
    } else {
      zoom = 12;
    }
    useMapStore.getState().flyTo(result.lon, result.lat, zoom);
    setShowDropdown(false);
    setQuery(result.name);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }, []);

  return (
    <div className="search-bar" ref={containerRef}>
      <div className="search-input-wrapper">
        <Search size={16} />
        <input
          className="search-input"
          type="text"
          placeholder="搜索地名或坐标..."
          value={query}
          onChange={handleInputChange}
          onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {showDropdown && results.length > 0 && (
        <div className="search-results">
          {results.map((r, idx) => (
            <div
              key={`${r.type}-${r.name}-${idx}`}
              className="search-result-item"
              onClick={() => handleSelect(r)}
            >
              <span className="search-result-name">{r.name}</span>
              <span className={`search-type-badge search-type-badge--${r.type}`}>
                {TYPE_LABELS[r.type] || r.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
