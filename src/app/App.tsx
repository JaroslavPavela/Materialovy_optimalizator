import { CalculatePanel } from '../ui/CalculatePanel.tsx';
import { ExportPanel } from '../ui/ExportPanel.tsx';
import { FileDrop } from '../ui/FileDrop.tsx';
import { Logo } from '../ui/Logo.tsx';
import { PartsTable } from '../ui/PartsTable.tsx';
import { PlanView } from '../ui/PlanView.tsx';
import { ProjectPanel } from '../ui/ProjectPanel.tsx';
import { ResultSummary } from '../ui/ResultSummary.tsx';
import { SheetSettings } from '../ui/SheetSettings.tsx';

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Logo height={36} />
        <h1>Materiálový optimalizátor</h1>
        <p className="muted">Nářezové plány pro CNC.</p>
      </header>
      <div className="layout">
        <aside className="inputs">
          <ProjectPanel />
          <FileDrop />
          <PartsTable />
          <SheetSettings />
        </aside>
        <main className="results">
          <CalculatePanel />
          <ResultSummary />
          <PlanView />
          <ExportPanel />
        </main>
      </div>
      <footer className="app-footer">
        Vytvořeno 2026 za pomoci{' '}
        <a href="https://claude.com/claude-code" target="_blank" rel="noopener noreferrer">
          Claude Code
        </a>
      </footer>
    </div>
  );
}
