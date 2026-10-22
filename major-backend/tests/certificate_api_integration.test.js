import assert from "node:assert/strict";
import { test, after, before } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { User } from "../src/models/user.models.js";

let server;
let baseUrl;
let originalFindById;

const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-jwt-access-secret-key-for-tests-only-min32chars";

function generateTestToken(userId, email, role = "student") {
    return jwt.sign(
        { _id: userId.toString(), email, role },
        JWT_SECRET,
        { expiresIn: "1h" }
    );
}

before(() => {
    originalFindById = User.findById;
    // Mock User.findById so offline tests return instantaneously
    User.findById = function (id) {
        return {
            select: function () {
                const idStr = id?.toString();
                if (idStr === "507f191e810c19729de860ea") {
                    return Promise.resolve({
                        _id: id,
                        fullName: "Test Admin",
                        email: "tpo@campus.edu",
                        role: "admin"
                    });
                }
                return Promise.resolve({
                    _id: id,
                    fullName: "Test Student",
                    email: "student@campus.edu",
                    role: "student"
                });
            }
        };
    };
});

test("Certificate API Integration: Starts HTTP test server", async () => {
    server = app.listen(0);
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

test("Certificate API: Rejects unauthenticated requests with 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/certificates/my`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
});

test("Certificate API: Rejects admin endpoints for student roles with 403", async () => {
    const fakeStudentId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
    const studentToken = generateTestToken(fakeStudentId, "student@campus.edu", "student");

    const res = await fetch(`${baseUrl}/api/v1/admin/certificates`, {
        headers: {
            Authorization: `Bearer ${studentToken}`
        }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.message, /Admin privileges required/);
});

test("Certificate API: Upload endpoint validates required certificate file", async () => {
    const fakeStudentId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
    const studentToken = generateTestToken(fakeStudentId, "student@campus.edu", "student");

    // Send request without file
    const res = await fetch(`${baseUrl}/api/v1/certificates`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${studentToken}`
        }
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /Please upload a certificate document/);
});

test("Certificate API: Rejects review decision without mandatory reason", async () => {
    const fakeAdminId = new mongoose.Types.ObjectId("507f191e810c19729de860ea");
    const adminToken = generateTestToken(fakeAdminId, "tpo@campus.edu", "admin");

    const fakeCertId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439099");
    const res = await fetch(`${baseUrl}/api/v1/admin/certificates/${fakeCertId}/review`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            decision: "REJECTED",
            reason: "" // Empty reason must be rejected with 400
        })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /mandatory reason is required/);
});

after(async () => {
    User.findById = originalFindById;
    if (server?.listening) {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
});
