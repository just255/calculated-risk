# Season & Biome Visual Design Reference

> **Purpose:** Define the visual mood and feel of every season x biome combination as seen from a **top-down camera**. This is an inspirational reference for sprite creation and config tuning — the authoritative numeric values live in `season-config.js`.

> **Perspective:** Everything described here is what the player sees looking DOWN at the battlefield. Canopy shapes, ground colors between gaps, particle movement across the viewport.

---

## Biome Reference

| Biome | Tree Mix | Visual Character |
|-------|----------|-----------------|
| **Temperate Forest** | Oak 60%, Birch 30%, Dead 10% | Mixed canopy sizes and shapes, varied ground |
| **Oak Forest** | Oak 85%, Dead 15% | Large uniform canopies, dark floor |
| **Birch Grove** | Birch 80%, Oak 15%, Dead 5% | Small bright canopies, lots of visible ground |
| **Conifer Forest** | Pine 90%, Dead 10% | Pointed dark canopies, needle carpet |
| **Wetland** | Willow 80%, Dead 20% | Wide drooping canopies, reed-choked ground |
| **Dead Forest** | Dead 100% | Bare branch skeletons, debris-covered ground |

---

# SUMMER (Baseline)

> **General:** Full foliage, peak green. The forest is at maximum density. This is the default — all other seasons are variations from here.

---

### Summer x Temperate Forest

**Mood:** The standard battlefield. Mixed canopy sizes dot the view — large round oak crowns alongside smaller, brighter birch clusters. The ground between them shows a patchwork of green-brown leaf litter and bare earth. Scattered brush fills the mid-gaps. A functional, readable forest from above — you can distinguish trees, identify gaps, plan routes.

**Palette:** Medium-to-dark green canopy. Light brown-green ground. Birch canopies read as lighter, yellow-green spots among the darker oaks.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Mixed sizes. Oak = large, dark, round. Birch = smaller, lighter, more open. Occasional dead trunk visible as bare branches. |
| Ground | Thin leaf scatter. Mostly bare earth with grass tint. Brush clusters in gaps between trees. |
| Particles | Rare. Occasional leaf drifting slowly across the viewport. |
| Environment | Clean. Full shadow pools under canopies. Bright ground between trees. Good contrast. |

**Battlefield Read:** Clear distinction between cover (under canopy) and open ground. Easy to plan movement. Moderate concealment.

---

### Summer x Oak Forest

**Mood:** The viewport is dominated by canopy. Massive dark-green circles overlap and interlock, leaving only narrow slivers of visible ground. Where ground does show, it's dark — permanent shade has kept it bare and mulchy. Dense brush clusters choke the few gaps. From above, it reads as a near-solid green ceiling with dark veins between the crowns.

**Palette:** Dark forest green canopy filling most of the view. Near-black ground in the narrow gaps. Brush reads as medium-green clusters at canopy edges.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Massive, overlapping circles. 80%+ of viewport is canopy. Dark green, uniform tone. Very few gaps. |
| Ground | Barely visible. Dark mulch-brown where it shows. Dense brush fills most openings. |
| Particles | Almost none. Still air trapped under the canopy ceiling. |
| Environment | Deep shadow everywhere. Low contrast between canopy and ground — everything is dark-toned. |

**Battlefield Read:** Hard to read. Troop positions hidden under the canopy blanket. Movement paths unclear from above. Claustrophobic density.

---

### Summer x Birch Grove

**Mood:** The opposite of Oak Forest. Small, light canopies float above a bright, sun-washed floor. From above, the white trunks are visible through the thin foliage — pale dots at the center of each small green circle. The ground between trees is bright, grassy, open. It reads airy and exposed — a beautiful killing field.

**Palette:** Light yellow-green canopy clusters. Bright tan/green ground. White trunk centers visible. High overall brightness.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Small, spaced apart. Light yellow-green. Individual crowns clearly distinct — no overlap. Thin enough to see trunk centers. |
| Ground | Highly visible. Bright grass-green and pale dried leaves. Fern clusters. Park-like openness between trees. |
| Particles | More active. Light leaves catch the wind, spin across the viewport. Gentle movement. |
| Environment | Bright and well-lit. Sharp but narrow shadows under each small canopy. High contrast. |

**Battlefield Read:** Excellent visibility. Troops clearly visible in the open ground between trees. Little concealment. Long sightlines.

---

### Summer x Conifer Forest

**Mood:** A grid of dark pointed shapes. Pine canopies from above are smaller and more triangular than deciduous trees — dark blue-green arrows pointing up from a warm brown needle carpet. The ground between them is a uniform reddish-brown — no grass, no variety, just endless needles. Monotone and disorienting. Every part of the map looks like every other part.

**Palette:** Dark blue-green pointed canopies. Warm reddish-brown needle floor. Very low color variety. Monotone.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Smaller, pointed/conical shapes. Dense dark blue-green. Even spacing. Uniform in size and color. |
| Ground | Thick needle carpet — warm reddish-brown everywhere. No grass. Rare fern clusters. Uniform texture. |
| Particles | Sparse. Occasional needle drops. Slow, straight-line falls. |
| Environment | Dim. Diffuse shadows, not sharp. Everything slightly desaturated. Cooler tone despite warm ground. |

**Battlefield Read:** Disorienting sameness. Hard to orient on the map — no landmarks. Regular tree spacing creates corridors but they all look the same.

---

### Summer x Wetland

**Mood:** Lush and overgrown. From above, willow canopies are wide, irregular shapes — organic and flowing, not the neat circles of oaks. The ground between them is choked with reed clusters and brush, barely any bare earth visible. Where ground shows, it's dark and damp. Occasional water glint. The whole scene reads as dense, tangled, impassable.

**Palette:** Rich multi-tone greens. Dark willow canopy, bright reed clusters, muddy brown-green ground. Occasional water-blue glint.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Wide, drooping willow shapes — flowing and irregular. Gaps between trees filled with bright green reed/brush masses. |
| Ground | Minimal visibility. Dark damp soil or shallow water. Mostly hidden under brush and reeds. |
| Particles | Slow-moving. Seed fluff, low-flying debris. Drifts across viewport lazily. |
| Environment | Soft diffuse shadows. No sharp edges. Everything feels damp and heavy. High vegetation density. |

**Battlefield Read:** Maximum clutter. Troop positions obscured by both canopy and ground vegetation. Channels of movement are narrow, winding, unpredictable.

---

### Summer x Dead Forest

**Mood:** Stark. From above, dead trees are transparent — bare branch skeletons that cast thin cross-hatch shadows on the ground below. The ground is fully visible: covered in debris, fallen bark, scattered twigs. No green anywhere. Brown, gray, lifeless. Post-bombardment wasteland. The trees provide no concealment — they're just obstacles.

**Palette:** Gray-brown branch skeletons. Tan/gray debris-covered ground. No green. Desaturated, washed out.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Bare branches — thin, skeletal. You see through them to the ground. Cast thin, sharp shadows. No foliage mass. |
| Ground | Fully exposed. Covered in debris, bark chips, fallen twigs. Dry, dusty appearance. |
| Particles | Twigs and bark flakes. Occasional drift. Sparse but noticeable against the barren ground. |
| Environment | Bright — no canopy shade. Harsh, flat lighting. Everything exposed and starkly lit. |

**Battlefield Read:** Total visibility. No concealment from canopy — branches are transparent. Troops fully exposed. The debris on the ground is the only visual complexity. Pure open-field warfare with obstacles.

---

# FALL

> **General:** The transition toward death. Deciduous trees shift to amber, rust, gold. Heavy leaf litter accumulates. Particles increase dramatically — leaves are falling constantly. The world is beautiful but decaying. Conifers barely change.

---

### Fall x Temperate Forest

**Mood:** The canopy is on fire — oaks have turned deep amber and burnt orange, birches are bright gold. From above it's a tapestry of warm colors. The ground between trees is buried under fallen leaves — thick orange-brown carpets replacing the summer's bare earth. Particles are everywhere, drifting across the viewport in lazy spirals. The forest is shedding.

**Palette:** Amber/orange oak canopy. Gold/yellow birch canopy. Orange-brown leaf carpet on ground. Warm overall temperature.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Oaks = deep amber/burnt orange. Birch = bright gold/yellow. Still full-ish coverage but visibly thinning at edges. Some gaps opening up. |
| Ground | Thick fallen leaf carpet. Orange, brown, gold mixed. Covers the earth completely. Brush starting to thin. |
| Particles | Heavy. Leaves drifting constantly across the viewport. Multiple at once. Warm colors. |
| Environment | Warm golden light tone. Softer shadows as canopy thins. Slight haze quality. |

**Battlefield Read:** Visually busy. The warm colors make it harder to pick out troop silhouettes. Falling particles add movement noise. Ground leaf carpet could mask footprints/tracks.

---

### Fall x Oak Forest

**Mood:** The dark cathedral turns amber. Those massive overlapping canopies shift from green to deep burnt-sienna and russet. The ground — previously invisible under the canopy — starts to appear as the crowns thin. What you see below is a thick blanket of brown-orange leaves. The forest is still dense but losing its grip. Darker, moodier than temperate fall.

**Palette:** Deep russet/burnt-sienna canopy. Dark brown leaf carpet. Less bright than temperate — the oaks go dark-warm, not bright-warm.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Still massive circles but thinning. Deep russet-brown, not bright orange. More gaps visible than summer. |
| Ground | Thick dark leaf carpet. Rich brown. Dense but the brush is dying back, revealing more floor. |
| Particles | Moderate. Heavy oak leaves fall slower, fewer at once than temperate. Bigger, darker leaf sprites. |
| Environment | Dim but warm-toned. Soft amber cast. Less harsh than summer shade. |

**Battlefield Read:** Slightly more readable than summer oak — the thinning canopy reveals more ground. But the warm dark palette makes everything blend together.

---

### Fall x Birch Grove

**Mood:** The bright grove turns golden. Birch canopies become brilliant yellow — the lightest, brightest canopy in fall across all biomes. From above, it's a scatter of gold coins on a pale yellow leaf carpet. The ground is littered but the leaves are light and bright. The openness remains — birch fall is graceful, not heavy.

**Palette:** Brilliant gold/yellow canopy. Pale gold leaf carpet. White trunks still visible. Brightest fall palette.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Bright gold/yellow. Noticeably thinner than summer — gaps widening. Trunks more visible from above. |
| Ground | Light golden leaf litter. Not as thick as oak — birch leaves are small and scattered. Ground still bright. |
| Particles | Active. Small gold leaves spinning, frequent. Light and fluttery. |
| Environment | Bright and warm. Golden light quality. Shadows softening as canopy thins. |

**Battlefield Read:** Still exposed. The golden palette is visually striking but doesn't add concealment. Troops stand out against the bright leaf carpet.

---

### Fall x Conifer Forest

**Mood:** Almost unchanged. Pines are evergreen — the canopy stays dark blue-green. The only fall signal is a slightly thicker needle carpet and occasional brown twig debris on the floor. From above, it's barely distinguishable from summer. The forest ignores the season. Cold and indifferent.

**Palette:** Same dark blue-green canopy. Slightly warmer brown needle carpet. Minimal change from summer.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Unchanged. Dark blue-green, pointed, dense. No color shift. |
| Ground | Marginally thicker needle carpet. Slightly more debris — a few brown twig sprites mixed in. |
| Particles | Slightly more needle drops than summer. Still sparse. |
| Environment | Unchanged. Same dim, diffuse quality. |

**Battlefield Read:** Identical to summer. Consistent year-round. Reliable terrain — no seasonal surprises.

---

### Fall x Wetland

**Mood:** The wetland turns muted and soggy. Willow canopies go from green to a dull yellow-olive — not the bright gold of birch but a tired, brownish yellow. The reeds brown and thin out, revealing more dark muddy ground and standing water beneath. The lush summer tangle loosens, replaced by a wet, decaying atmosphere.

**Palette:** Dull olive-yellow willow canopy. Brown dying reeds. Dark mud and water visible. Muted, desaturated.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Dull yellow-olive. Thinning and drooping lower. Less defined shape as leaves fall. |
| Ground | More visible as reeds die back. Dark wet mud, standing water pools. Brown reed stubble. |
| Particles | Dying reed fragments. Slow drift. Darker, heavier than summer. |
| Environment | Gray-toned. Overcast quality. Puddle reflections. Damp atmosphere. |

**Battlefield Read:** More open than summer wetland as vegetation dies back. Water and mud visible — affects movement planning. Soggy terrain reads from above.

---

### Fall x Dead Forest

**Mood:** Dead forest in fall is just... more dead. The already-bare skeletons now stand over a floor scattered with additional debris blown in from living forests nearby. Twig density increases. The only fall color comes from stray leaves that blew in from elsewhere — a few random orange/gold spots on the gray debris carpet. Melancholy.

**Palette:** Same gray-brown skeletons. Ground slightly warmer with stray fallen leaves. Tiny pops of orange in the debris.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Unchanged — already bare. Same thin skeleton shadows. |
| Ground | More debris. Scattered orange/gold foreign leaves among the gray. Slightly more visual variety than summer dead forest. |
| Particles | More active. Twigs and foreign leaves blowing through. The dead forest catches others' debris. |
| Environment | Windier feel. More particle movement. Same harsh flat lighting. |

**Battlefield Read:** Same full visibility. The scattered color flecks add minor visual noise but don't affect concealment.

---

# WINTER

> **General:** Bare deciduous canopies. Desaturated palette. Frost or snow on the ground. Minimal particles — the world is frozen and still. Maximum visibility through stripped branches. The battlefield is exposed and unforgiving.

---

### Winter x Temperate Forest

**Mood:** The canopy is gone. From above, you see branch skeletons where oaks and birches used to provide cover. The ground is fully exposed — a carpet of dried brown leaves with frost edges, possibly snow patches. The forest's structure is laid bare: trunk positions, gaps, paths — all visible. Sparse dead brush. The battlefield has been stripped of its concealment.

**Palette:** Gray-brown branch skeletons. Frost-white and dried-brown ground. Desaturated, cold. Blue-gray undertone.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Bare branches on deciduous trees. Thin shadow patterns on ground. You see through everything. Dead trees indistinguishable from living ones now. |
| Ground | Dried brown leaves, frost patches, possible thin snow. Fully visible. Low saturation. |
| Particles | Almost none. Occasional dry leaf tumbling in wind. A few snowflakes if snow is enabled. |
| Environment | Cold, bright. Blue-gray ambient tone. Sharp thin shadows from bare branches. Frost sparkle on ground. |

**Battlefield Read:** Maximum visibility. The forest's concealment is gone. You can see everything — every position, every route. But so can the enemy. The tables are even.

---

### Winter x Oak Forest

**Mood:** The impenetrable oak cathedral is reduced to a skeleton cathedral. Those massive canopy circles are now bare branch webs — you can see the ground everywhere. The dense mulch floor is frosted and pale. The brush that choked the gaps is dead brown stalks. From above, it's a maze of trunk positions with no walls. The bones of the forest.

**Palette:** Dark gray branch networks. Frost-brown ground. Dead brown brush stalks. Stark, architectural.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Bare branch networks — the massive structure is visible but transparent. Complex shadow lattice on the ground. |
| Ground | Thick dry leaf carpet, frost-edged. Darker than temperate. Dead brush stalks — brown and sparse. |
| Particles | Almost none. An occasional dry leaf scraping across frozen ground. |
| Environment | Cold, stark. The branch network creates complex but thin shadow patterns. Blue-cold tone. |

**Battlefield Read:** Dramatically different from summer. The formerly invisible ground is now fully exposed. Trunk positions visible — can plan routes. The forest is a structural maze, not a concealment maze.

---

### Winter x Birch Grove

**Mood:** The already-exposed birch grove becomes even more stark. White trunks stand like bare poles in a frozen field. No foliage at all. The ground is a frost-white and pale tan carpet. From above, it's abstract — white dots (trunks) on a white-tan field. The highest-contrast, most minimalist winter scene. Almost beautiful in its emptiness.

**Palette:** White trunk dots on frost-white ground. Very low saturation. Near-monochrome.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Nothing. Bare thin branches barely visible from above. White trunks are the primary feature. |
| Ground | Frost-white over pale dried leaves. Snow patches. Almost paper-white in places. |
| Particles | Minimal. Snowflakes drifting down. A rare dry leaf. |
| Environment | Maximum brightness. Cold blue-white tone. Minimal shadows — nothing to cast them. |

**Battlefield Read:** Total exposure. Troops are dark silhouettes on a white field. No concealment exists. The ultimate open terrain.

---

### Winter x Conifer Forest

**Mood:** The one biome where winter looks *different* from a conifer perspective. The canopy holds — pines keep their dark blue-green needles. But the ground shifts: the needle carpet takes on a frost-blue tint, possibly dusted with snow. From above, it's dark green canopy over white-brown floor. The contrast between the living canopy and frozen ground is striking. The only forest that still provides concealment in winter.

**Palette:** Same dark blue-green canopy. Frost-blue/white tinted needle floor. High contrast between canopy and ground.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Unchanged — dark blue-green, dense, pointed. Full coverage. The evergreen advantage. |
| Ground | Needle carpet with frost overlay. Bluish-white tint. Snow accumulation in gaps. Colder than summer. |
| Particles | Snow falling through gaps. Occasional needle. More activity than summer. |
| Environment | Cold. High contrast — dark canopy against bright frosted ground. Crisp shadows. |

**Battlefield Read:** The only winter biome with concealment. Canopy still hides positions. But the bright ground makes movement between trees more visible. Cover exists but transitions are dangerous.

---

### Winter x Wetland

**Mood:** The wetland freezes. Bare willow skeletons drape thin branch tendrils over frozen mud and ice pools. Reeds are brown dead stalks poking through frost. From above, it's a bleak expanse of gray-brown and ice-white. The summer's lush tangle is reduced to sparse sticks over a frozen swamp. Depressing. The water features that made it impassable are now frozen solid.

**Palette:** Gray-brown bare willows. Frost-white and ice-blue ground. Dead brown reed stalks. Bleak and cold.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Bare willow branches — thin, drooping tendrils visible from above. No concealment. |
| Ground | Frozen mud, ice pools (light blue-white patches). Dead reed stalks. Snow in patches. |
| Particles | Very sparse. Occasional ice crystal or frozen reed fragment. |
| Environment | Cold and gray. Flat, overcast lighting. Ice glints on water surfaces. Still and silent. |

**Battlefield Read:** Formerly impassable wetland is now navigable (frozen). But there's no concealment — willows are bare, reeds are dead. Open, bleak terrain with obstacle features.

---

### Winter x Dead Forest

**Mood:** Dead forest in winter is death squared. Bare skeletons over a frozen debris field. Snow dusts the horizontal branches and covers the ground debris. From above, it's white and gray — almost no color. The most barren, hostile terrain in the game. Post-nuclear. Nothing lives here and the weather confirms it.

**Palette:** Gray skeletons. White snow over gray debris. Essentially monochrome. Coldest, most desaturated scene in the game.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Same bare skeletons, now with snow dust on horizontal branches. Thin shadows on white ground. |
| Ground | Snow over debris. White with gray-brown showing through. Frozen, lifeless. |
| Particles | Snowflakes only. Slow, steady fall. |
| Environment | Brightest dead forest — snow reflects light. Cold blue-white. Maximum starkness. |

**Battlefield Read:** Identical to other dead forest seasons in terms of visibility — total. The snow makes troop silhouettes even more visible. Most exposed terrain possible.

---

# SPRING

> **General:** Renewal. New green growth emerging through winter's debris. Deciduous trees budding — thin, translucent canopies. Scattered petals. The ground shows decomposing winter leaf litter mixed with fresh green growth. Everything feels delicate, transitional, slightly chaotic.

---

### Spring x Temperate Forest

**Mood:** The forest is waking up. From above, canopies are thin and translucent — new light-green buds, not full foliage. You can still see branch structure through the young leaves. The ground is messy: decomposing brown winter leaves mixed with bright green new growth and scattered flower petals. Brush is small and fresh. It reads as a transition — half-winter, half-summer. Patchy and uneven.

**Palette:** Light translucent green canopy. Mixed ground — brown decomposing leaves + bright green new growth. Occasional white/pink petal spots.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Thin, translucent. Light green — almost lime. You can still see branch structure through the leaves. Semi-transparent from above. |
| Ground | Messy. Brown decomposing leaves + fresh green patches. Scattered petal spots. Uneven coloring. |
| Particles | Petals and pollen. Light, floating, frequent. White and pink specks drifting across viewport. |
| Environment | Bright but soft. Warm-cool mix — greenish light. Soft shadows through thin canopy. |

**Battlefield Read:** Partial concealment. Canopy is thin enough to see through in places. The messy ground makes it harder to read troop positions — visual clutter from mixed colors.

---

### Spring x Oak Forest

**Mood:** The oak cathedral is rebuilding. Massive branch structures are visible with thin new leaf clusters budding along them — from above, the canopy is a dappled pattern of green spots on a branch network. Not solid yet. The ground is visible through the developing canopy — thick decomposing brown leaf mulch from fall/winter with green shoots pushing through. Dense brush is small and fresh.

**Palette:** Dappled light-green on dark branch network. Brown decomposing floor with green shoots. Less bright than temperate spring.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Half-transparent. Branch structure visible with light green leaf clusters. Not yet a solid canopy. Dappled pattern from above. |
| Ground | More visible than summer. Dark brown decomposing mulch. Fresh green brush sprouts. Mossy patches. |
| Particles | Some petals. Less than temperate — oaks don't produce showy flowers. Occasional dead leaf from winter still tumbling. |
| Environment | Warmer than winter, cooler than summer. Dappled light pattern on ground. Moderate shadows. |

**Battlefield Read:** Interesting transitional state — more visible than summer but the dappled canopy creates visual confusion. Partial concealment. Hard to tell if a shadow is a canopy gap or a troop position.

---

### Spring x Birch Grove

**Mood:** The birch grove greens up early and fast. Thin but bright new leaves — from above, the canopies are delicate light-green circles, almost glowing. The white trunks are still very visible through the thin foliage. Ground shows a mix of pale winter debris and vivid green new growth. The lightest, most optimistic spring scene. Catkins and pollen floating everywhere.

**Palette:** Bright lime-green thin canopy. White trunks visible. Pale ground with vivid green patches. Light and fresh.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Thin lime-green circles. Bright but translucent. Trunks visible as white centers. Delicate. |
| Ground | Pale winter debris + bright green new growth patches. Fern fronds unfurling. More ground visible than summer. |
| Particles | Active. Catkins, pollen puffs, small leaves. White-yellow specks floating frequently. |
| Environment | Bright, fresh. Warm light. Soft shadows. Lightest, most cheerful atmosphere. |

**Battlefield Read:** Still exposed. The thin canopy doesn't conceal much. But the active particles and mixed ground colors create more visual noise than winter's clean white.

---

### Spring x Conifer Forest

**Mood:** Another minimal-change season for conifers. The canopy is unchanged — same dark blue-green. The ground shows a shift: the frost is gone, replaced by the year-round needle carpet with some new fern growth pushing through. Slightly greener undertone to the floor. A few bright green "candle" tips on the pine branches add subtle freshness. Otherwise, the stoic pines continue to ignore the seasons.

**Palette:** Same dark blue-green canopy with tiny bright green tips. Needle carpet slightly greener. Subtle fern patches.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Unchanged dark blue-green with bright green growth tips (barely visible from above). Still dense. |
| Ground | Needle carpet, slightly warmer/greener than winter. New fern sprouts in gaps. Frost gone. |
| Particles | Slight increase from winter. Some pollen. Otherwise same sparse needles. |
| Environment | Warmer than winter. Slightly brighter ground. Same dim canopy shade. |

**Battlefield Read:** Same as always. The pines don't care what season it is. Reliable, predictable terrain.

---

### Spring x Wetland

**Mood:** The wetland explodes back to life. From above, willows are budding with bright light-green leaves — thin, wispy canopy starting to form. The real action is on the ground: reeds shooting up in vivid green clusters, new brush sprouting, water visible and unfrozen. The frozen winter swamp is now a muddy, budding wetland. Messy, lively, chaotic. Everything is growing at once.

**Palette:** Light green willow buds. Vivid green new reeds. Brown mud and standing water. Chaotic multi-green with brown.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Thin willow canopy, light green. Drooping branch structure still visible. Semi-transparent. |
| Ground | Mud, standing water, vivid green reed shoots. Winter debris mixed with new growth. Active, messy. |
| Particles | Pollen, willow catkins, seed fluff. Active, drifting over the water. |
| Environment | Damp. Soft light. Possible morning mist/fog. Reflections in water. Warm but humid. |

**Battlefield Read:** Chaotic ground clutter is returning. Reed growth starting to obscure movement lanes again. Water is thawed — back to being an obstacle. Transitional mess.

---

### Spring x Dead Forest

**Mood:** The only spring scene with no renewal. Dead trees don't bud. The frozen debris field thaws into a muddy debris field. Snow melts to reveal the same gray-brown mess underneath. If anything, spring makes the dead forest look worse — wet, muddy, rotting. The contrast with other biomes' renewal makes this one feel more hopeless. Nature moved on. This place didn't.

**Palette:** Same gray-brown skeletons. Wet, muddy ground. Darker brown than winter's clean snow-white. Rotting debris.

| Layer | Top-Down Appearance |
|-------|-------------------|
| Canopy | Same bare skeletons. Snow gone from branches. Slightly darker without snow contrast. |
| Ground | Wet muddy debris. Snow melted to reveal rotting material. Darker, soggier than winter. Puddle patches. |
| Particles | Wet debris. Occasional twig in wind. Less clean than winter's snowflakes — messy. |
| Environment | Damp, overcast quality. Less bright than winter (no snow reflection). Gray light. Puddles. |

**Battlefield Read:** Same full visibility. Slightly worse ground readability — wet mud and puddles add visual complexity without adding concealment.

---

# Appendix: Seasonal Sprite Requirements

## Floor Sprites Needed
| Sprite | Used In | Description |
|--------|---------|-------------|
| `floor-leaf` | Summer deciduous | Fresh green leaves on ground |
| `floor-leaf-fall` | Fall deciduous | Orange/red/gold fallen leaves |
| `floor-leaf-dry` | Winter/Spring deciduous | Brown, dried, decomposing leaves |
| `floor-needle` | All seasons conifer | Pine needle carpet |
| `floor-debris` | Dead forest, all seasons | Bark, twigs, dead material |

## Particle Sprites Needed
| Sprite | Used In | Description |
|--------|---------|-------------|
| `particle-leaf` | Summer deciduous | Green leaf drifting |
| `particle-leaf-fall` | Fall deciduous | Orange/gold leaf falling |
| `particle-leaf-dry` | Winter deciduous | Brown dried leaf tumbling |
| `particle-petal` | Spring deciduous | White/pink flower petals |
| `particle-needle` | All seasons conifer | Pine needle falling |
| `particle-twig` | Dead forest, fall debris | Small twig/bark fragment |

## Environmental Sprites (Future)
| Sprite | Used In | Description |
|--------|---------|-------------|
| `env-snow` | Winter (all biomes) | Snowflake falling |
| `env-puddle` | Spring wetland, spring dead | Ground water pool |
| `env-frost` | Winter ground overlay | Frost texture on ground |
| `env-fog` | Spring wetland, fall wetland | Fog/mist particle |

---

# Appendix: Config Value Guidance

Quick reference for the numeric config that implements these moods. Exact values are in `season-config.js`.

## Density Multiplier Ranges
| Season x Category | Floor | Particle | Brush | Why |
|-------------------|-------|----------|-------|-----|
| Summer deciduous | 0.6 | 0.3 | 1.0 | Baseline — moderate shedding |
| Summer conifer | 1.0 | 0.3 | 0.6 | Needles accumulate, sparse undergrowth |
| Fall deciduous | 2.0 | 2.0 | 0.7 | Heavy shedding, brush dying |
| Fall conifer | 1.0 | 0.5 | 0.6 | Minimal change |
| Winter deciduous | 0.5 | 0.1 | 0.3 | Bare, frozen, almost nothing falling |
| Winter conifer | 1.0 | 0.4 | 0.3 | Needles persist, some snow |
| Spring deciduous | 0.4 | 0.6 | 0.5 | Old decomposing + petals, fresh brush |
| Spring conifer | 1.0 | 0.5 | 0.5 | Needles persist, new ferns |

## Canopy Color Shifts
| Season | Deciduous Hue | Deciduous Sat | Deciduous Brightness |
|--------|--------------|---------------|---------------------|
| Summer | 0 | 1.0 | 1.0 |
| Fall | +30 (toward orange) | 1.2 | 0.9 |
| Winter | 0 | 0.3 | 0.8 |
| Spring | -10 (toward yellow-green) | 1.1 | 1.1 |

*Conifers: negligible shift across all seasons. Dead trees: no shift (always gray-brown).*
