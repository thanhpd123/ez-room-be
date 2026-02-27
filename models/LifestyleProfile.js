const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const LifestyleProfile = sequelize.define('LifestyleProfile', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        smoking: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        drinking: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        pets_allowed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        sleep_schedule: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        personality_type: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        cleanliness: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        noise_tolerance: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        guest_frequency: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        cooking_frequency: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        work_from_home: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        wake_time: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        bedtime: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        social_level: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        occupation_type: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        interests: {
            type: DataTypes.ARRAY(DataTypes.STRING(100)),
            allowNull: true,
            defaultValue: [],
        },
        languages: {
            type: DataTypes.ARRAY(DataTypes.STRING(20)),
            allowNull: true,
            defaultValue: [],
        },
        preferred_lease_months: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        move_in_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        temperature_preference: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        quiet_hours_preference: {
            type: DataTypes.STRING(30),
            allowNull: true,
        },
    }, {
        tableName: 'lifestyle_profiles',
        timestamps: true,
        underscored: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    LifestyleProfile.associate = (models) => {
        LifestyleProfile.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
    };

    return LifestyleProfile;
};
