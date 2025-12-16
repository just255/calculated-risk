# Calculated Risk 🎖️

A military-themed math training game designed to help build speed and automaticity with basic math facts.

## Quick Start

### Prerequisites
- Node.js installed on your computer (https://nodejs.org)

### Setup

1. Open a terminal/command prompt in this folder

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

4. You'll see output like:
   ```
   ╔═══════════════════════════════════════════════════════╗
   ║           CALCULATED RISK - SERVER ONLINE             ║
   ╠═══════════════════════════════════════════════════════╣
   ║  Local:    http://localhost:3000                      ║
   ║  Network:  http://192.168.1.xxx:3000                  ║
   ╠═══════════════════════════════════════════════════════╣
   ║  Share the Network URL with your son's phone!         ║
   ╚═══════════════════════════════════════════════════════╝
   ```

5. **On your PC**: Open http://localhost:3000
6. **On mobile**: Connect to the same WiFi and open the Network URL shown

## Gameplay

### Concept
Enemy waves advance from the top. Your factory produces units to defend - but only when you solve math problems correctly!

### Controls
- **Tap lane slots** at the bottom to open the production panel
- **Deploy** to send a unit (costs Command Points + correct answer)
- **Switch** to change the unit type for that lane

### Mechanics
- **Command Points (CP)**: Regenerate slowly over time. Solving problems = instant deployment.
- **Unit Difficulty**: Harder math problems produce stronger units
- **Random Events**: Airstrikes and artillery require quick solving to intercept

### Modes
- **Campaign**: 10 waves, escalating difficulty
- **Endless**: Survive as long as possible, chase high scores

### Settings
- Toggle operations: +, −, ×, ÷
- Adjust number range (1-12)
- Set difficulty (affects wrong answer choices)
- Math frequency (how often problems are required)

## Files

- `index.html` - The game
- `server.js` - Express + Socket.io server (multiplayer-ready)
- `package.json` - Node dependencies

## Multiplayer (Coming Soon)

The server infrastructure is ready for head-to-head battles. In v2:
- Find match to connect with opponent
- Solving problems sends enemies to opponent's side
- First to destroy the other's base wins

## Troubleshooting

**Mobile can't connect?**
- Make sure both devices are on the same WiFi network
- Try disabling Windows Firewall temporarily, or add an exception for port 3000
- Some networks (especially public/guest WiFi) block device-to-device connections

**Game feels slow on mobile?**
- Try closing other apps
- Ensure good WiFi signal

---

Built with ❤️ for mastering math facts through play.
