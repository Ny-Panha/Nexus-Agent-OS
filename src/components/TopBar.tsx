import {
  Search,
  Bell,
  Contrast,
  PanelRight,
  RefreshCw,
  LayoutGrid,
} from 'lucide-react';
import type { UiLanguage } from '../../shared/types';
import { t } from '../lib/i18n';

interface TopBarProps {
  language: UiLanguage;
  wsConnected: boolean;
  needsYouCount: number;
  glassOpacity: number;
  inspectorOpen: boolean;
  refreshingProviders: boolean;
  onOpenCommandPalette: () => void;
  onClickNeedsYou: () => void;
  onChangeGlassOpacity: (value: number) => void;
  onToggleInspector: () => void;
  onRefreshProviders: () => void;
}

export function TopBar({
  language,
  wsConnected,
  needsYouCount,
  glassOpacity,
  inspectorOpen,
  refreshingProviders,
  onOpenCommandPalette,
  onClickNeedsYou,
  onChangeGlassOpacity,
  onToggleInspector,
  onRefreshProviders,
}: TopBarProps) {
  const copy = t(language);
  const isElectron = Boolean(window.nexusDesktop?.isDesktop);

  return (
    <header className="h-[44px] shrink-0 px-3 flex items-center justify-between gap-2 select-none electron-drag overflow-hidden">
      {/* Left: Brand */}
      <div className="flex items-center gap-2 shrink-0 electron-no-drag">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center border shrink-0"
          style={{
            backgroundColor: 'var(--accent-soft)',
            borderColor: 'var(--border-strong)',
            color: 'var(--accent)',
          }}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)] whitespace-nowrap">
          {copy.appName}
        </span>
        <span
          title={wsConnected ? 'Local Engine Online' : 'Reconnecting...'}
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${wsConnected ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`}
        />
      </div>

      {/* Center: Global Search / Jump Pill */}
      <div className="flex-1 min-w-[140px] max-w-[420px] electron-no-drag">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="w-full h-[30px] px-3 rounded-lg border flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer hover:border-[var(--border-strong)]"
          style={{
            backgroundColor: 'var(--bg-panel)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{copy.searchPlaceholder}</span>
          </span>
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/[0.05] border border-white/[0.08] text-[var(--text-secondary)] shrink-0">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Right: Utilities + Glass Slider + Inspector Toggle */}
      <div
        className={`flex items-center gap-1.5 shrink-0 electron-no-drag ${isElectron ? 'pr-[138px]' : 'pr-0.5'}`}
      >
        <button
          type="button"
          onClick={onRefreshProviders}
          disabled={refreshingProviders}
          title="Refresh AI account statuses & models"
          className="h-7 px-2 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer hover:bg-white/[0.06] disabled:opacity-50"
          style={{
            backgroundColor: 'var(--bg-panel)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw className={`w-3 h-3 ${refreshingProviders ? 'animate-spin' : ''}`} />
          <span className="hidden xl:inline">Sync</span>
        </button>

        <button
          type="button"
          onClick={onClickNeedsYou}
          title={copy.needsYou}
          className="relative h-7 w-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer hover:bg-white/[0.07] text-[var(--text-secondary)]"
        >
          <Bell className="w-3.5 h-3.5" />
          {needsYouCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
              {needsYouCount}
            </span>
          )}
        </button>

        {/* Live Glass / Opacity Slider */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2 h-7 rounded-lg border"
          style={{
            backgroundColor: 'var(--bg-panel)',
            borderColor: 'var(--border-subtle)',
          }}
          title={`Glass opacity: ${glassOpacity}%`}
        >
          <Contrast className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
          <input
            type="range"
            min={72}
            max={100}
            value={glassOpacity}
            onChange={(e) => onChangeGlassOpacity(Number(e.target.value))}
            aria-label="Glass opacity"
            className="w-16 h-1 accent-[var(--accent)] cursor-pointer"
          />
        </div>

        <button
          type="button"
          onClick={onToggleInspector}
          title={inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
          className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            inspectorOpen
              ? 'bg-white/[0.09] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
