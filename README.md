# Edikte

[Deutsch](#deutsch) · [English](#english)

## Deutsch

Edikte ist eine Desktop-App für macOS und Windows. Die App listet Versteigerungen aus der Ediktsdatei (edikte.justiz.gv.at) auf, die Sie nach dem Preis pro m² filtern können. Gutachten lädt die App bei Bedarf herunter und lässt sie von einem KI-Anbieter auswerten, bei dem Sie sich selbst anmelden.

Die App ist für den privaten Gebrauch gedacht. Sie ist kein Angebot des Bundesministeriums für Justiz und steht in keiner Verbindung zu ihm.

### Installation

Die Dateien finden Sie unter „Releases“ auf der GitHub-Seite dieses Projekts. Wählen Sie die Datei, die zu Ihrem Computer passt:

| Computer                           | Datei                                |
| ---------------------------------- | ------------------------------------ |
| Mac mit Apple-Chip (M1 oder neuer) | `Edikte-<Version>-mac-arm64.dmg`     |
| Mac mit Intel-Prozessor            | `Edikte-<Version>-mac-x64.dmg`       |
| Windows, 64 Bit                    | `Edikte-<Version>-win-x64-setup.exe` |

Welchen Chip Ihr Mac hat, steht im Apple-Menü unter „Über diesen Mac“. Die `.zip`-Dateien enthalten dieselbe Mac-App, nur ohne Disk-Image.

- macOS: Öffnen Sie die `.dmg`-Datei und ziehen Sie Edikte in den Ordner „Programme“.
- Windows: Starten Sie die `setup.exe`. Sie installiert Edikte ohne Administratorrechte nur für Ihr Benutzerkonto in `%LOCALAPPDATA%\Programs\edikte`, legt Verknüpfungen im Startmenü und auf dem Desktop an und startet die App.

`SHA256SUMS.txt` enthält die SHA-256-Prüfsummen aller Dateien eines Releases. Auf dem Mac berechnen Sie die Prüfsumme im Terminal mit `shasum -a 256 <Datei>`, unter Windows in der PowerShell mit `Get-FileHash <Datei>`.

### Nicht signierte App öffnen

Die Builds sind nicht mit einem Entwicklerzertifikat signiert. Deshalb müssen Sie die App beim ersten Start einmal ausdrücklich zulassen.

macOS:

1. Öffnen Sie Edikte. macOS meldet, dass die App nicht geöffnet wurde. Klicken Sie auf „Fertig“.
2. Öffnen Sie „Systemeinstellungen“ > „Datenschutz & Sicherheit“ und scrollen Sie nach unten zu „Sicherheit“.
3. Klicken Sie bei der Meldung zu Edikte auf „Dennoch öffnen“ und bestätigen Sie mit Ihrem Passwort oder mit Touch ID.
4. Klicken Sie im nächsten Fenster noch einmal auf „Dennoch öffnen“.

Danach startet Edikte ohne diese Abfrage. Nach dem Download einer neuen Version kann sie wieder erscheinen.

Windows: SmartScreen meldet „Der Computer wurde durch Windows geschützt“. Klicken Sie auf „Weitere Informationen“ und dann auf „Trotzdem ausführen“.

### KI-Anbieter verbinden

Für die Auswertung der Gutachten verbinden Sie Edikte in den Einstellungen mit einem dieser Anbieter:

| Verbindung              | Was Sie brauchen                                                |
| ----------------------- | --------------------------------------------------------------- |
| Anmeldung mit ChatGPT   | ein ChatGPT-Konto                                               |
| Claude-Kommandozeile    | das Programm `claude` von Anthropic, installiert und angemeldet |
| Codex-Kommandozeile     | das Programm `codex` von OpenAI, installiert und angemeldet     |
| OpenAI-API-Schlüssel    | einen API-Schlüssel aus Ihrem OpenAI-Konto                      |
| Anthropic-API-Schlüssel | einen API-Schlüssel aus Ihrem Anthropic-Konto                   |

- Bei den Kommandozeilen startet Edikte Ihr eigenes Programm, das unter Ihrem Konto läuft. Die Anmeldedaten dieser Programme liest Edikte nicht. Findet Edikte ein Programm nicht, wählen Sie seine Datei in den Einstellungen aus.
- Die ChatGPT-Anmeldung und API-Schlüssel speichert Edikte verschlüsselt im Datenordner, auf dem Mac mit einem Schlüssel aus dem Schlüsselbund, unter Windows mit der Datenverschlüsselung von Windows (DPAPI). Umgebungsvariablen wie `OPENAI_API_KEY` oder `ANTHROPIC_API_KEY` liest Edikte nicht.
- Mit einem API-Schlüssel rechnet der Anbieter die Analysen nach Verbrauch über Ihr Konto ab.
- Edikte ist nicht Claude Code und kein Produkt von Anthropic oder OpenAI.

### Datenordner

Edikte speichert alle Daten in einem Ordner:

- macOS: `~/Library/Application Support/Edikte`
- Windows: `%APPDATA%\Edikte`

Darin liegen die Datenbank (`edikte.sqlite`), die heruntergeladenen Gutachten (`documents`) und die verschlüsselten Anmeldedaten (`secrets.json`). Den genauen Pfad zeigt das App-Fenster nach „Datenordner:“ an.

Um alle Daten zu löschen, beenden Sie Edikte und löschen den Ordner. Auf dem Mac bleibt danach im Schlüsselbund ein Eintrag „Edikte Safe Storage“, den Sie in der Schlüsselbundverwaltung löschen können. Unter Windows deinstallieren Sie die App unter „Einstellungen“ > „Apps“ > „Installierte Apps“. Der Datenordner bleibt dabei erhalten.

### Datenschutz

- Edikte ruft die öffentlichen Seiten der Ediktsdatei ab, höchstens eine Anfrage pro Sekunde.
- Gutachten nennen die Eigentümer und enthalten Daten aus dem Grundbuch. Die heruntergeladenen Dateien bleiben im Datenordner auf Ihrem Computer.
- Der Text eines Gutachtens geht erst an Ihren KI-Anbieter, wenn Sie eine Analyse starten. Vor der ersten Analyse fragt Edikte, ob Sie damit einverstanden sind. Für die Verarbeitung beim Anbieter gelten dessen Bedingungen.

### Entwicklung

Sie brauchen Node.js 24 oder neuer.

```sh
npm ci                # Abhängigkeiten installieren
npm run dev           # App mit Hot Reload
npm run dev:renderer  # nur die Oberfläche im Browser, mit erfundenen Beispieldaten
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Unit-Tests (Vitest)
npm run test:e2e      # baut die App und startet den Playwright-Smoke-Test
npm run dist:mac      # Mac-Pakete für die Architektur dieses Macs, in dist/
npm run dist:win      # Windows-Installer, in dist/
```

Ein gebautes Paket prüfen Sie mit dem Selbsttest. Er startet die App mit einem leeren, temporären Datenordner und endet mit Exit-Code 0, wenn die Oberfläche ihre Daten vom Hauptprozess bekommen hat:

```sh
node scripts/run-self-check.mjs dist/mac-arm64/Edikte.app/Contents/MacOS/Edikte
```

Für ein Release erhöhen Sie die Version und pushen den Tag:

```sh
npm version 0.2.0 -m "chore(release): %s"
git push --follow-tags
```

Der Workflow „Release“ baut die Pakete für macOS (arm64 und x64) und Windows (x64), prüft jedes Paket mit dem Selbsttest und legt einen Release-Entwurf mit `SHA256SUMS.txt` an. Den Entwurf veröffentlichen Sie danach selbst auf GitHub. Ein manueller Lauf über „Run workflow“ baut die Pakete ohne Release. Sie bleiben 14 Tage als Artefakte des Laufs erhalten.

Die Regeln für Code, Daten und Tests stehen in [CLAUDE.md](CLAUDE.md).

## English

Edikte is a desktop app for macOS and Windows. It lists court auctions from the Austrian edicts database (Ediktsdatei, edikte.justiz.gv.at), and you can filter the list by price per m². It downloads appraisal reports (Gutachten) on demand and has them analysed by an AI provider that you sign in to yourself.

The app is meant for personal use. It is not a service of the Austrian Federal Ministry of Justice (Bundesministerium für Justiz) and has no connection to it.

### Installation

The files are under "Releases" on this project's GitHub page. Pick the file for your computer:

| Computer                             | File                                 |
| ------------------------------------ | ------------------------------------ |
| Mac with Apple silicon (M1 or later) | `Edikte-<version>-mac-arm64.dmg`     |
| Mac with an Intel processor          | `Edikte-<version>-mac-x64.dmg`       |
| Windows, 64-bit                      | `Edikte-<version>-win-x64-setup.exe` |

To see which chip your Mac has, choose "About This Mac" from the Apple menu. The `.zip` files contain the same Mac app without a disk image.

- macOS: Open the `.dmg` file and drag Edikte into the Applications folder.
- Windows: Run the `setup.exe`. It installs Edikte for your user account only, without administrator rights, into `%LOCALAPPDATA%\Programs\edikte`, adds shortcuts to the Start menu and the desktop, and starts the app.

`SHA256SUMS.txt` lists the SHA-256 checksums of all files in a release. On a Mac, compute a checksum in Terminal with `shasum -a 256 <file>`. On Windows, use `Get-FileHash <file>` in PowerShell.

### Opening the unsigned app

The builds are not signed with a developer certificate, so you have to allow the app once when you first start it.

macOS:

1. Open Edikte. macOS reports that the app was not opened. Click "Done".
2. Open "System Settings" > "Privacy & Security" and scroll down to "Security".
3. Next to the message about Edikte, click "Open Anyway" and confirm with your password or Touch ID.
4. In the next window, click "Open Anyway" again.

After that, Edikte starts without asking. The prompt can come back after you download a new version.

Windows: SmartScreen shows "Windows protected your PC". Click "More info", then "Run anyway".

### Connecting an AI provider

To analyse appraisal reports, connect Edikte to one of these providers in Settings:

| Connection           | What you need                                                |
| -------------------- | ------------------------------------------------------------ |
| Sign in with ChatGPT | a ChatGPT account                                            |
| Claude command line  | the `claude` program from Anthropic, installed and signed in |
| Codex command line   | the `codex` program from OpenAI, installed and signed in     |
| OpenAI API key       | an API key from your OpenAI account                          |
| Anthropic API key    | an API key from your Anthropic account                       |

- With a command-line tool, Edikte starts your own program, which runs under your account. Edikte does not read the sign-in data of these programs. If Edikte cannot find a program, choose its file in Settings.
- Edikte stores the ChatGPT sign-in and API keys encrypted in the data folder, on a Mac with a key from the keychain, on Windows with Windows data protection (DPAPI). Edikte does not read environment variables such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
- With an API key, the provider bills the analyses to your account by usage.
- Edikte is not Claude Code and is not a product of Anthropic or OpenAI.

### Data folder

Edikte keeps all its data in one folder:

- macOS: `~/Library/Application Support/Edikte`
- Windows: `%APPDATA%\Edikte`

It holds the database (`edikte.sqlite`), the downloaded appraisal reports (`documents`) and the encrypted sign-in data (`secrets.json`). The app window shows the exact path after "Data folder:".

To delete all data, quit Edikte and delete the folder. On a Mac, a keychain item named "Edikte Safe Storage" remains, which you can delete in Keychain Access. On Windows, uninstall the app under "Settings" > "Apps" > "Installed apps". This keeps the data folder.

### Privacy

- Edikte fetches the public pages of the Ediktsdatei, at most one request per second.
- Appraisal reports name the owners and contain land register (Grundbuch) data. The downloaded files stay in the data folder on your computer.
- The text of a report goes to your AI provider only when you start an analysis. Before the first analysis, Edikte asks for your consent. The provider's own terms apply to how it processes the text.

### Development

You need Node.js 24 or later.

```sh
npm ci                # install dependencies
npm run dev           # app with hot reload
npm run dev:renderer  # interface only, in a browser, with made-up sample data
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # unit tests (Vitest)
npm run test:e2e      # builds the app and runs the Playwright smoke test
npm run dist:mac      # Mac packages for this Mac's architecture, in dist/
npm run dist:win      # Windows installer, in dist/
```

The self-check tests a packaged build. It starts the app with an empty temporary data folder and exits with code 0 when the interface received its data from the main process:

```sh
node scripts/run-self-check.mjs dist/mac-arm64/Edikte.app/Contents/MacOS/Edikte
```

To release, raise the version and push the tag:

```sh
npm version 0.2.0 -m "chore(release): %s"
git push --follow-tags
```

The Release workflow builds the packages for macOS (arm64 and x64) and Windows (x64), runs the self-check on each package and creates a draft release with `SHA256SUMS.txt`. You publish the draft on GitHub yourself. A manual run with "Run workflow" builds the packages without a release and keeps them as run artifacts for 14 days.

The rules for code, data and tests are in [CLAUDE.md](CLAUDE.md).
