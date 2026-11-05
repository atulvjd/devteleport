require "formula"
require "tmpdir"
require "json"

root = Pathname.new(__dir__).parent
formula_path = root/"packaging/homebrew/Formula/devteleport.rb"
# Load the local definition for an isolated test; public installation uses the tap.
require formula_path.to_s
formula = Devteleport.new("devteleport", formula_path, :stable)
raise "Wrong formula version" unless formula.version.to_s == "0.2.2"

# Run the actual Homebrew staging/install/test methods with a disposable prefix.
# Never install into the real Cellar or link over a user's devteleport executable.
Dir.mktmpdir("devteleport-brew-") do |temporary|
  temporary = Pathname.new(temporary)
  formula.define_singleton_method(:prefix) { |_version = nil| temporary/"prefix" }
  formula.brew do
    formula.install
  end
  raise "Missing CLI wrapper" unless (formula.bin/"devteleport").executable?
  raise "Missing compiled dependency adapters" unless (formula.libexec/"packages/core/python-setup.js").file?
  metadata = JSON.parse((formula.libexec/"package.json").read)
  raise "Incorrect installed version" unless metadata.fetch("version") == "0.2.2"
  formula.run_test
  puts "PASS Homebrew formula: verified download, isolated install, encrypted source-removal restore and archive verification"
end
