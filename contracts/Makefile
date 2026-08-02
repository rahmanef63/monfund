# MonFund contracts. Run every target from `contracts/`.
#
# `lib/` is gitignored, so a clean clone has no dependencies at all — `make
# install` is the first thing to run, and it pins both deps to exact tags so
# two clones resolve the same source. OZ v5.4.0 is the version this tree is
# written against (ReentrancyGuard, pragma ^0.8.20).

FORGE_STD_TAG := v1.16.2
OZ_TAG        := v5.4.0

# Overridable on the command line, e.g. `make dry-run RPC=https://...`.
RPC          ?= https://testnet-rpc.monad.xyz
SAFE_ADDRESS ?=

.PHONY: install build test gas dry-run clean

# `@tag=` (rather than a bare `@`) forces an exact tag match instead of letting
# forge fall back to a branch or rev of the same name — the tags above are the pin.
#
# `--no-git` is required, not cosmetic: without it `forge install` registers each dep
# as a git submodule, writing a `.gitmodules` at the REPO ROOT and staging
# `contracts/lib/*` gitlinks — which directly contradicts `contracts/lib/` being
# gitignored, and leaves every clean clone with a dirty index after `make install`.
# A plain pinned fetch into lib/ is what this repo wants.
install:
	forge install --no-git foundry-rs/forge-std@tag=$(FORGE_STD_TAG) OpenZeppelin/openzeppelin-contracts@tag=$(OZ_TAG)

build:
	forge build

test:
	forge test

gas:
	forge test --gas-report

# Simulation only — never broadcasts. `--sender` makes the simulated nonce and
# CREATE address match what the Safe would actually produce.
dry-run:
	@test -n "$(SAFE_ADDRESS)" || (echo "set SAFE_ADDRESS=0x... (the deploying Safe)" && exit 1)
	forge script script/Deploy.s.sol:DeployScript --rpc-url $(RPC) --sender $(SAFE_ADDRESS)

clean:
	forge clean
