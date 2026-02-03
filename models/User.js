const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        user_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        full_name: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
            validate: {
                isEmail: true,
            },
        },
        password: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        gender: {
            type: DataTypes.ENUM('male', 'female', 'other'),
            allowNull: true,
        },
        birth_year: {
            type: DataTypes.INTEGER,
            allowNull: true,
            validate: {
                min: 1900,
                max: new Date().getFullYear(),
            },
        },
        avatar_url: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'users',
        timestamps: false,
    });

    User.associate = (models) => {
        // User has one UserRole
        User.belongsTo(models.UserRole, {
            foreignKey: 'role_id',
            as: 'role',
        });

        // User has one LifestyleProfile
        User.hasOne(models.LifestyleProfile, {
            foreignKey: 'user_id',
            as: 'lifestyleProfile',
        });

        // User has one UserPreference
        User.hasOne(models.UserPreference, {
            foreignKey: 'user_id',
            as: 'preference',
        });

        // User has one Wallet
        User.hasOne(models.Wallet, {
            foreignKey: 'user_id',
            as: 'wallet',
        });

        // User has many Rentals
        User.hasMany(models.Rental, {
            foreignKey: 'user_id',
            as: 'rentals',
        });

        // User has many RoommateMatches
        User.hasMany(models.RoommateMatch, {
            foreignKey: 'user_id',
            as: 'roommateMatches',
        });

        // User has many Feedbacks (written by user)
        User.hasMany(models.Feedback, {
            foreignKey: 'user_id',
            as: 'feedbacks',
        });

        // User has many Messages (sent)
        User.hasMany(models.Message, {
            foreignKey: 'sender_id',
            as: 'sentMessages',
        });

        // User has many Notifications
        User.hasMany(models.Notification, {
            foreignKey: 'user_id',
            as: 'notifications',
        });

        // User has many FavoriteRooms
        User.hasMany(models.FavoriteRoom, {
            foreignKey: 'user_id',
            as: 'favoriteRooms',
        });

        // User has many Preorders
        User.hasMany(models.Preorder, {
            foreignKey: 'user_id',
            as: 'preorders',
        });
    };

    return User;
};
