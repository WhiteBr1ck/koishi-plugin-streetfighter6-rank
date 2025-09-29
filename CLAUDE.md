# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Koishi plugin (`koishi-plugin-streetfighter6-rank`) that provides Street Fighter 6 player data querying functionality. The plugin scrapes data from the official Street Fighter 6 Buckler website and provides commands for querying player rankings, win rates, battle logs, and player search.

## Build Commands

- **No build script defined**: The project uses TypeScript compilation directly via `tsc` (see tsconfig.json)
- **TypeScript compilation**: `tsc` - Compiles TypeScript from `src/` to `lib/`
- **Output directory**: `lib/` (contains compiled JS and declaration files)

## Architecture

### Core Dependencies
- **Koishi framework**: Main chatbot framework (`^4.18.7` peer dependency)
- **Required services**: `puppeteer` (for screenshots), `database` (for user ID bindings)
- **Main file**: `src/index.ts` (single-file plugin)

### Key Components

1. **Data Models**:
   - `RankData`: Player ranking information (character, rank, points, etc.)
   - `WinRateData`: Player win rate statistics
   - `PlayerSearchResult`: Search results for player lookup
   - `StreetFighter6Binding`: Database model for user ID bindings

2. **Core Services**:
   - **Web scraping**: HTTP requests to Buckler website with Cookie authentication
   - **Screenshot capture**: Puppeteer-based page screenshots
   - **Caching system**: Simple in-memory cache with TTL (600s default)
   - **Database**: User ID binding storage

3. **Main Commands**:
   - `排位查询` - Query player ranking data
   - `胜率查询` - Query player win rates
   - `战斗记录` - Query battle logs (screenshot only)
   - `玩家搜索` - Search for players by name
   - `绑定ID` / `解绑ID` - Bind/unbind player IDs to users

### Configuration Schema
- **Website settings**: Base URL, locale, User-Agent, Cookie
- **Auto-login settings**: Capcom email, password, and `cookieRefreshInterval` (in hours, 0 to disable).
- **Feature toggles**: Text output, screenshot output, forward messages
- **Debug options**: Verbose logging

### Data Flow
1. Commands parse user input and retrieve bound player IDs if needed
2. HTTP requests fetch HTML from Buckler website
3. HTML parsing extracts structured data using regex patterns
4. Puppeteer captures screenshots of specific page elements
5. Results are cached and formatted for output
6. Both text and image responses are sent to users

## Development Notes

- **HTML parsing**: Uses regex patterns to extract data from Buckler website HTML
- **Cookie authentication**: Required for accessing most Buckler functionality. The `performAutoLogin` function now checks for an existing login session before submitting credentials.
- **Multi-language support**: Supports zh-hans, zh-hant, en-us, ja-jp, ko-kr locales
- **Error handling**: Graceful degradation when text or screenshot features fail
- **Rate limiting**: Built-in cooldown system (5s default) to prevent spam

## File Structure

- `src/index.ts` - Main plugin implementation (1600+ lines)
- `lib/` - Compiled TypeScript output
- `package.json` - Plugin metadata and dependencies
- `tsconfig.json` - TypeScript compilation settings