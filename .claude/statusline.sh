#!/bin/bash
# Claude Code Status Line — reads JSON from stdin (Claude Code injects context data)
# Model: claude-opus-4.8 [1m] · 1M context window
# rate_limits fields are Claude.ai Pro/Max only and appear after the first API response.
set -f

input=$(cat)
[ -z "$input" ] && { printf "Claude"; exit 0; }

# ── Colors (truecolor) ──────────────────────────────────
blue='\033[38;2;0;153;255m'
cyan='\033[38;2;86;182;194m'
green='\033[38;2;0;255;65m'      # matrix/hacker green
orange='\033[38;2;255;150;40m'
yellow='\033[38;2;230;200;0m'
red='\033[38;2;255;85;85m'
white='\033[38;2;220;220;220m'
dim='\033[2m'
reset='\033[0m'
sep=" ${dim}│${reset} "

# ── Helpers ─────────────────────────────────────────────
# green < 50, orange 50–69, yellow 70–89, red >= 90
color_for_pct() {
    local pct=$1
    if   [ "$pct" -ge 90 ]; then printf "$red"
    elif [ "$pct" -ge 70 ]; then printf "$yellow"
    elif [ "$pct" -ge 50 ]; then printf "$orange"
    else printf "$green"
    fi
}

build_bar() {
    local pct=$1 width=$2
    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100
    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))
    local bc; bc=$(color_for_pct "$pct")
    local f="" e=""
    for ((i=0; i<filled; i++)); do f+="●"; done
    for ((i=0; i<empty;  i++)); do e+="○"; done
    printf "${bc}${f}${dim}${e}${reset}"
}

# epoch -> "2:30pm" (time) or "jun 26, 9:00am" (datetime)
format_epoch() {
    local epoch=$1 style=$2 r=""
    { [ -z "$epoch" ] || [ "$epoch" = "null" ] || [ "$epoch" = "0" ]; } && return
    case "$style" in
        datetime) r=$(date -r "$epoch" +"%b %-d, %l:%M%p" 2>/dev/null || date -d "@$epoch" +"%b %-d, %l:%M%P" 2>/dev/null) ;;
        *)        r=$(date -r "$epoch" +"%l:%M%p" 2>/dev/null || date -d "@$epoch" +"%l:%M%P" 2>/dev/null) ;;
    esac
    printf "%s" "$(echo "$r" | sed 's/^ //; s/  / /g' | tr '[:upper:]' '[:lower:]')"
}

# ── Extract data ────────────────────────────────────────
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
[ -z "$CWD" ] || [ "$CWD" = "null" ] && CWD=$(pwd)
DIR=${CWD##*/}
CTX=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# git branch + dirty flag
BRANCH=""; DIRTY=""
if git -C "$CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    BRANCH=$(git -C "$CWD" symbolic-ref --short HEAD 2>/dev/null)
    [ -n "$(git -C "$CWD" --no-optional-locks status --porcelain 2>/dev/null)" ] && DIRTY="*"
fi

# rate limits (Pro/Max only, after first API response)
FIVE_PCT=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' | cut -d. -f1)
FIVE_RST=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
WEEK_PCT=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' | cut -d. -f1)
WEEK_RST=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# ── Line 1: model │ context │ dir (branch*) ─────────────
CTX_COLOR=$(color_for_pct "$CTX")
line1="${blue}${MODEL}${reset}${sep}$(build_bar "$CTX" 10) ${CTX_COLOR}$(printf '%-4s' "${CTX}%")${reset} ${dim}ctx${reset}${sep}📁 ${cyan}${DIR}${reset}"
[ -n "$BRANCH" ] && line1+=" ${green}(${BRANCH}${red}${DIRTY}${green})${reset}"

# ── Rate-limit lines ────────────────────────────────────
# Mirror line 1's "{MODEL} │ {bar}": right-justify the label to the model width,
# then the same " │ " separator, so the bars line up across all three lines.
LBLW=${#MODEL}
rate=""
if [ -n "$FIVE_PCT" ]; then
    c=$(color_for_pct "$FIVE_PCT"); t=$(format_epoch "$FIVE_RST" time)
    rate+="${white}$(printf '%*s' "$LBLW" "current")${reset}${sep}$(build_bar "$FIVE_PCT" 10) ${c}$(printf '%-4s' "${FIVE_PCT}%")${reset} ${dim}  ⟳${reset}"
    [ -n "$t" ] && rate+="${sep}${white}${t}${reset}"
fi
if [ -n "$WEEK_PCT" ]; then
    c=$(color_for_pct "$WEEK_PCT"); t=$(format_epoch "$WEEK_RST" datetime)
    [ -n "$rate" ] && rate+="\n"
    rate+="${white}$(printf '%*s' "$LBLW" "weekly")${reset}${sep}$(build_bar "$WEEK_PCT" 10) ${c}$(printf '%-4s' "${WEEK_PCT}%")${reset} ${dim}  ⟳${reset}"
    [ -n "$t" ] && rate+="${sep}${white}${t}${reset}"
fi

# ── Output ──────────────────────────────────────────────
printf "%b" "$line1"
[ -n "$rate" ] && printf "\n%b" "$rate"
