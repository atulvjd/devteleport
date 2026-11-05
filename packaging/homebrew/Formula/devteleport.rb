class Devteleport < Formula
  desc "Encrypted local-first development workspace snapshots"
  homepage "https://github.com/atulvjd/devteleport"
  url "https://registry.npmjs.org/devteleport/-/devteleport-0.2.2.tgz"
  sha256 "1e7f0aeeafc40afacc846b10f896be93d2a844bf3f62f34322e4324c1b6884db"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"devteleport").write_env_script libexec/"apps/cli/main.js",
                                      PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    source = testpath/"source"
    source.mkpath
    (source/"hello.txt").write "Homebrew encrypted roundtrip\n"
    ENV["DEVTELEPORT_PASSWORD"] = "Homebrew disposable fixture passphrase"

    system bin/"devteleport", "capture", "--root", source,
           "--name", "homebrew-test", "--output", testpath
    assert_equal "DTP2", (testpath/"homebrew-test.dtp").binread(4)
    source.rmtree
    system bin/"devteleport", "restore", testpath/"homebrew-test.dtp",
           "--target", testpath/"restored"
    assert_equal "Homebrew encrypted roundtrip\n", (testpath/"restored/hello.txt").read
    system bin/"devteleport", "verify", testpath/"restored",
           "--snapshot", testpath/"homebrew-test.dtp"
  end
end
