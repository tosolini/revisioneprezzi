import MarkdownDocPage from '../components/MarkdownDocPage'

const DLGS36_QUICK_NAV = [
  { label: 'Vai alla Tabella D.2', href: '#tabella-d2' },
  { label: 'Vai alla Tabella D.3', href: '#tabella-d3' },
]

export default function Dlgs36Page() {
  return <MarkdownDocPage src="/dlgs36-2023.md" searchPlaceholder="Cerca nel testo della legge..." quickNav={DLGS36_QUICK_NAV} />
}
