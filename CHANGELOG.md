# Changelog

## [0.1.3](https://github.com/simkimsia/netlify-axi/compare/netlify-axi-v0.1.2...netlify-axi-v0.1.3) (2026-10-23)


### Features

* add deploy command wrapping `netlify deploy` ([da76eb1](https://github.com/simkimsia/netlify-axi/commit/da76eb1ec84ec3cba3c512ee4f88b2b3f4c587cc)), closes [#14](https://github.com/simkimsia/netlify-axi/issues/14)
* add deploys command listing a site's deploys ([d2251ac](https://github.com/simkimsia/netlify-axi/commit/d2251ac8308a7c9ab6ab1fa4187e222bda1ff858)), closes [#19](https://github.com/simkimsia/netlify-axi/issues/19)
* add env command listing the linked site's variable names ([1771228](https://github.com/simkimsia/netlify-axi/commit/177122862984685b2b6929a870518f0fbac044ff)), closes [#11](https://github.com/simkimsia/netlify-axi/issues/11)
* list env var names across every deploy context ([44e7094](https://github.com/simkimsia/netlify-axi/commit/44e70949bb9daa09c5ac73489f20d338e2baf637)), closes [#11](https://github.com/simkimsia/netlify-axi/issues/11)


### Bug Fixes

* check netlify-cli version before deploy and survive large build logs ([120bdd8](https://github.com/simkimsia/netlify-axi/commit/120bdd8a27e5fec59b441664b087b0f5ee757db1)), closes [#23](https://github.com/simkimsia/netlify-axi/issues/23)
* keep env var values out of every env error ([0bafd58](https://github.com/simkimsia/netlify-axi/commit/0bafd58890497526d136e12d31dd52e225596f82)), closes [#11](https://github.com/simkimsia/netlify-axi/issues/11)
* name the listed site in deploys' deploy hints ([20c35f7](https://github.com/simkimsia/netlify-axi/commit/20c35f7c8fa79e88d61314d6941b4ef9cebcbc6a)), closes [#19](https://github.com/simkimsia/netlify-axi/issues/19)
* state the netlify-cli floor for deploy and stop reporting unconfirmed deploys ([8a90d29](https://github.com/simkimsia/netlify-axi/commit/8a90d292d68f1dd1637dad230f0ed5aa6f3a044d)), closes [#14](https://github.com/simkimsia/netlify-axi/issues/14)

## [0.1.2](https://github.com/simkimsia/netlify-axi/compare/netlify-axi-v0.1.1...netlify-axi-v0.1.2) (2026-10-07)


### Features

* AXI_DEBUG=1 prints forwarded netlify argv to stderr ([d3d6c3d](https://github.com/simkimsia/netlify-axi/commit/d3d6c3d4dd1ef84b3d841d27f1413008cea4bf2e)), closes [#15](https://github.com/simkimsia/netlify-axi/issues/15)

## [0.1.1](https://github.com/simkimsia/netlify-axi/compare/netlify-axi-v0.1.0...netlify-axi-v0.1.1) (2026-10-04)


### Features

* scaffold netlify-axi v0 with read-only commands ([7902014](https://github.com/simkimsia/netlify-axi/commit/7902014e64cf919b983c54e6cc6523cde2c684fb))
* ship installable agent skill with vendor-cli fallback protocol ([dbda80b](https://github.com/simkimsia/netlify-axi/commit/dbda80b4fd24b8d31c6483fa07379322f6e69985))


### Bug Fixes

* give UNKNOWN errors a next step ([5e53763](https://github.com/simkimsia/netlify-axi/commit/5e537638859cb5371d7b6088f9d776c0309df77a)), closes [#4](https://github.com/simkimsia/netlify-axi/issues/4)
