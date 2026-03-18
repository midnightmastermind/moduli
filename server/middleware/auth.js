io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;

    // No token → unauthenticated socket allowed (needed for login/register)
    if (!token) {
        socket.userId = null;
        return next();
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        // Token invalid → treat as logged-out user
        console.log("⚠️ Invalid token — connecting unauthenticated");
        socket.userId = null;
        return next();
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
        console.log("⚠️ User not found — clearing token and allowing unauthenticated socket");
        socket.userId = null;
        return next();
    }

    // Valid user
    socket.userId = user._id.toString();
    next();
});
