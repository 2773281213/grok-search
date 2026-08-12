'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    localStorage.setItem('cairn-theme', next ? 'dark' : 'light');
  }

  return (
    <button className="icon-button" type="button" onClick={toggle} aria-label={dark ? '切换浅色主题' : '切换深色主题'}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
